const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose'); // Switched from mysql2 to mongoose
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

// 3. MongoDB Atlas Connection & Schema
// mongoose.connect handles the connection pool automatically
const submissionSchema = new mongoose.Schema({
  fullName: String,
  designation: String,
  organization: String,
  location: String,
  emailMobile: String,
  advisoryRole: String,
  expertise: String,
  shortBio: String,
  experience: String,
  previousRoles: String,
  achievements: String,
  education: String,
  certifications: String,
  links: String,
  photoPath: String,
  consent: Boolean,
  createdAt: { type: Date, default: Date.now }
});

const Submission = mongoose.model('Submission', submissionSchema);

async function initDB() {
  try {
    console.log("Connecting to:", process.env.MONGODB_URI); // ADD THIS LINE
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Atlas Connected & AI Chat Ready');
  } catch (err) {
    console.error('⚠️ MongoDB Connection Error:', err.message);
  }
}

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

// 5. Professional Profile Submission Route (Updated for MongoDB)
app.post('/api/contact', upload.single('photo'), async (req, res) => {
  const data = req.body;
  const photoPath = req.file ? req.file.path : null;

  try {
    // 1. SAVE TO MONGODB
    const newSubmission = new Submission({
      fullName: data.fullName,
      designation: data.designation,
      organization: data.organization,
      location: data.location,
      emailMobile: data.emailMobile,
      advisoryRole: data.advisoryRole,
      expertise: data.expertise,
      shortBio: data.shortBio,
      experience: data.experience,
      previousRoles: data.previousRoles,
      achievements: data.achievements,
      education: data.education,
      certifications: data.certifications,
      links: data.links,
      photoPath: photoPath,
      consent: data.consent === 'true'
    });

    await newSubmission.save();

    // 2. RESPOND TO USER IMMEDIATELY
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
          <p><em>Full details are stored in MongoDB Atlas.</em></p>
        </div>
      `,
      attachments: req.file ? [{ filename: req.file.originalname, path: req.file.path }] : []
    };

    transporter.sendMail(mailOptions).catch(err => console.error("Background Email Error:", err));

  } catch (err) {
    console.error("Submission Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Server on http://localhost:${PORT}`);
  await initDB();
});
