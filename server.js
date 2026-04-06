const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
// Dynamic import for node-fetch to support CommonJS
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
require('dotenv').config();

const app = express();
// Render uses a dynamic port; 5000 is for local backup
const PORT = process.env.PORT || 5000; 

// Ensure 'uploads' directory exists for Render's ephemeral storage
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// 1. Configure Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// 2. Middleware with dynamic CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// 3. MySQL Connection
const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

// 4. Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 465,
  secure: true, 
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// --- AI CONFIGURATION ---
const SYSTEM_PROMPT = `You are CITTA, created by Aditya Patil. Use [REDIRECT_CONTACT] for contact intents.`;

app.post('/chat', async (req, res) => {
  const { message, history } = req.body;
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...(history || []).map(msg => ({ role: msg.role, content: msg.content })), { role: 'user', content: message }];
  try {
    const response = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + process.env.OLLAMA_API_KEY },
      body: JSON.stringify({ model: "gpt-oss:120b", messages, stream: false })
    });
    const data = await response.json();
    res.json({ reply: data.message.content });
  } catch (error) {
    res.status(500).json({ reply: "Connection error." });
  }
});

// 5. Initialize DB
async function initDB() {
  try {
    const conn = await pool.getConnection();
    await conn.execute(`CREATE TABLE IF NOT EXISTS professional_submissions (id INT AUTO_INCREMENT PRIMARY KEY, full_name VARCHAR(255), advisory_role VARCHAR(100), photo_path VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    conn.release();
    console.log('✅ DB Connected');
  } catch (err) { console.error('❌ DB Error:', err.message); }
}

// 6. Fast Submission Route
app.post('/api/contact', upload.single('photo'), async (req, res) => {
  try {
    await pool.execute(`INSERT INTO professional_submissions (full_name, advisory_role, photo_path) VALUES (?, ?, ?)`, [req.body.fullName, req.body.advisoryRole, req.file ? req.file.path : null]);
    
    // Respond immediately for speed
    res.status(201).json({ message: 'Success' });

    // Background email
    transporter.sendMail({ from: process.env.SMTP_USER, to: process.env.RECEIVER_EMAIL, subject: 'New Profile', text: 'New submission received.' }).catch(e => console.error(e));
  } catch (err) { if (!res.headersSent) res.status(500).json({ message: 'Error' }); }
});

// Bind to 0.0.0.0 for Render production
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Live on port ${PORT}`);
  await initDB();
});
