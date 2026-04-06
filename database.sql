-- CITTA Technologies Database Setup
-- Run this in your MySQL client before starting the backend

CREATE DATABASE IF NOT EXISTS citta_db;
USE citta_db;

CREATE TABLE IF NOT EXISTS contact_submissions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  full_name   VARCHAR(150) NOT NULL,
  email       VARCHAR(200) NOT NULL,
  company     VARCHAR(150),
  phone       VARCHAR(50),
  subject     VARCHAR(255) NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- View all contact submissions
-- SELECT * FROM contact_submissions ORDER BY created_at DESC;
