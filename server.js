const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
// Dynamic import for node-fetch to support CommonJS
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// 1. Configure Multer for Photo Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// 2. Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// 3. MySQL Connection Pool
const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || 'Aditya@136',
  database: process.env.DB_NAME     || 'citta_db',
  waitForConnections: true,
  connectionLimit: 10,
});

// 4. Nodemailer Transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 465,
  secure: true, 
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// --- CITTA AI CONFIGURATION ---
const SYSTEM_PROMPT = `
ROLE:
You are "CITTA", a professional customer support chatbot for CITTA TECHNOLOGIES. 
You were created by Aditya Patil.

REDIRECTION RULES:
If the user asks to "contact", "connect", "fill a form", "apply", "join", or "talk to a human":
1. Inform them that you are redirecting them to the Professional Profile/Contact form.
2. End your message with exactly this tag: [REDIRECT_CONTACT]

KNOWLEDGE BASE:
CITTA Technologies (est. 2009) offers:
* **Software Development**: Custom enterprise applications.
* **Mobile App Development**: Native iOS and Android.
* **Web Development**: Scalable digital experiences.
* **Cloud & DevOps**: AWS, Azure, and GCP.
* **Cybersecurity**: Audits and threat mitigation.

STRICT RULES:
1. Identify only as "CITTA". Do not mention RAG or AI models.
2. If asked for private info, say: "I'm sorry, I cannot disclose private company information."
`;

// --- AI CHAT ROUTE ---
app.post('/chat', async (req, res) => {
  const { message, history } = req.body;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(history || []).map(msg => ({ role: msg.role, content: msg.content })),
    { role: 'user', content: message }
  ];

  try {
    const response = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + process.env.OLLAMA_API_KEY
      },
      body: JSON.stringify({ model: "gpt-oss:120b", messages, stream: false })
    });
    const data = await response.json();
    res.json({ reply: data.message.content });
  } catch (error) {
    res.status(500).json({ reply: "I'm having trouble connecting to my systems." });
  }
});

// 5. Initialize Database
async function initDB() {
  try {
    const conn = await pool.getConnection();
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS professional_submissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(255),
        designation VARCHAR(255),
        organization VARCHAR(255),
        location VARCHAR(255),
        email_mobile VARCHAR(255),
        advisory_role VARCHAR(100),
        expertise TEXT,
        short_bio TEXT,
        experience TEXT,
        previous_roles TEXT,
        achievements TEXT,
        education TEXT,
        certifications TEXT,
        links TEXT,
        photo_path VARCHAR(255),
        consent TINYINT(1),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    conn.release();
    console.log('✅ Database & AI Chat Ready');
  } catch (err) {
    console.error('⚠️ Database Error:', err.message);
  }
}

// 6. Professional Profile Submission Route (Optimized for Speed)
app.post('/api/contact', upload.single('photo'), async (req, res) => {
  const data = req.body;
  const photoPath = req.file ? req.file.path : null;

  try {
    // 1. SAVE TO DATABASE (This is fast)
    await pool.execute(
      `INSERT INTO professional_submissions 
      (full_name, designation, organization, location, email_mobile, advisory_role, expertise, short_bio, experience, previous_roles, achievements, education, certifications, links, photo_path, consent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.fullName, data.designation, data.organization, data.location, 
        data.emailMobile, data.advisoryRole, data.expertise, data.shortBio,
        data.experience, data.previousRoles, data.achievements, data.education,
        data.certifications, data.links, photoPath, data.consent === 'true' ? 1 : 0
      ]
    );

    // 2. RESPOND TO USER IMMEDIATELY
    // The browser sees "Success" right now, while the email sends in the background.
    res.status(201).json({ message: 'Submission successful' });

    // 3. SEND EMAIL NOTIFICATION (Background process)
    const mailOptions = {
      from: `"${data.fullName}" <${process.env.SMTP_USER}>`,
      to: process.env.RECEIVER_EMAIL,
      subject: `New Advisor Profile: ${data.advisoryRole}`,
      html: `
        <div style="font-family: Arial, sans-serif; border: 1px solid #eee; padding: 20px;">
          <h2 style="color: #1a237e;">New Professional Submission</h2>
          <p><strong>Name:</strong> ${data.fullName}</p>
          <p><strong>Applied Role:</strong> ${data.advisoryRole}</p>
          <p><strong>Location:</strong> ${data.location}</p>
          <p><strong>Contact Info:</strong> ${data.emailMobile}</p>
          <hr/>
          <h4>Professional Bio</h4>
          <p>${data.shortBio}</p>
          <h4>Expertise</h4>
          <p>${data.expertise}</p>
          <h4>Education</h4>
          <p>${data.education}</p>
          <p><em>Full details are stored in the database.</em></p>
        </div>
      `,
      attachments: req.file ? [{ filename: req.file.originalname, path: req.file.path }] : []
    };

    // We do NOT use 'await' here so the server doesn't wait for the email provider.
    transporter.sendMail(mailOptions).catch(err => console.error("Background Email Error:", err));

  } catch (err) {
    console.error("Submission Error:", err);
    // Check if headers were already sent to prevent app crash
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Server on http://localhost:${PORT}`);
  await initDB();
});