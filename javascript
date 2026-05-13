// =========================
// FULLSTACK PROJECT STRUCTURE
// =========================

// package.json
{
  "name": "exolve-sms-dashboard",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "body-parser": "^1.20.2",
    "pg": "^8.11.0",
    "dotenv": "^16.3.1"
  }
}

// =========================
// server.js
// =========================

require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Init DB
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender TEXT,
      receiver TEXT,
      text TEXT,
      date TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS numbers (
      id SERIAL PRIMARY KEY,
      phone TEXT UNIQUE
    );
  `);
}
initDB();

// =========================
// WEBHOOK
// =========================

app.post("/api/webhook/sms", async (req, res) => {
  const secret = req.headers["x-secret"];

  if (secret !== process.env.EXOLVE_SECRET) {
    return res.status(403).send("Forbidden");
  }

  const sms = req.body;

  await pool.query(
    "INSERT INTO messages(sender, receiver, text, date) VALUES($1,$2,$3,$4)",
    [sms.sender, sms.receiver, sms.text, new Date(sms.date)]
  );

  res.sendStatus(200);
});

// =========================
// API
// =========================

app.get("/api/messages", async (req, res) => {
  const result = await pool.query("SELECT * FROM messages ORDER BY date DESC");
  res.json(result.rows);
});

app.get("/api/numbers", async (req, res) => {
  const result = await pool.query("SELECT * FROM numbers");
  res.json(result.rows);
});

app.post("/api/numbers", async (req, res) => {
  const { phone } = req.body;

  await pool.query("INSERT INTO numbers(phone) VALUES($1) ON CONFLICT DO NOTHING", [phone]);

  res.sendStatus(200);
});

app.delete("/api/numbers/:id", async (req, res) => {
  await pool.query("DELETE FROM numbers WHERE id=$1", [req.params.id]);
  res.sendStatus(200);
});

// =========================
// FRONTEND (simple HTML)
// =========================

app.get("/", (req, res) => {
  res.send(`
  <html>
  <head>
    <title>SMS Dashboard</title>
  </head>
  <body>
    <h1>SMS Dashboard</h1>

    <h2>Add Number</h2>
    <input id="phone" placeholder="+79999999999" />
    <button onclick="addNumber()">Add</button>

    <h2>Numbers</h2>
    <ul id="numbers"></ul>

    <h2>Messages</h2>
    <ul id="messages"></ul>

    <script>
      async function load() {
        const msgs = await fetch('/api/messages').then(r => r.json());
        const nums = await fetch('/api/numbers').then(r => r.json());

        document.getElementById('messages').innerHTML = msgs.map(m =>
          `<li>${m.sender} → ${m.receiver}: ${m.text}</li>`
        ).join('');

        document.getElementById('numbers').innerHTML = nums.map(n =>
          `<li>${n.phone} <button onclick="del(${n.id})">X</button></li>`
        ).join('');
      }

      async function addNumber() {
        const phone = document.getElementById('phone').value;
        await fetch('/api/numbers', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({phone})
        });
        load();
      }

      async function del(id) {
        await fetch('/api/numbers/' + id, {method: 'DELETE'});
        load();
      }

      setInterval(load, 2000);
      load();
    </script>
  </body>
  </html>
  `);
});

// =========================
// START
// =========================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on " + PORT));

// =========================
// .env EXAMPLE
// =========================

// DATABASE_URL=postgresql://...
// EXOLVE_SECRET=your_secret_here

// =========================
// DEPLOY (Railway)
// =========================

// 1. Push to GitHub
// 2. Connect repo to Railway
// 3. Add PostgreSQL plugin
// 4. Set ENV variables
// 5. Deploy

// Webhook URL:
// https://your-app.up.railway.app/api/webhook/sms
