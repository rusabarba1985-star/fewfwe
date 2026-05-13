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

// ======================
// INIT DB
// ======================
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

// ======================
// WEBHOOK (Exolve)
// ======================
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

// ======================
// API
// ======================
app.get("/api/messages", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM messages ORDER BY date DESC LIMIT 100"
  );
  res.json(result.rows);
});

app.get("/api/numbers", async (req, res) => {
  const result = await pool.query("SELECT * FROM numbers");
  res.json(result.rows);
});

app.post("/api/numbers", async (req, res) => {
  const { phone } = req.body;

  if (!phone) return res.status(400).send("No phone");

  await pool.query(
    "INSERT INTO numbers(phone) VALUES($1) ON CONFLICT DO NOTHING",
    [phone]
  );

  res.sendStatus(200);
});

app.delete("/api/numbers/:id", async (req, res) => {
  await pool.query("DELETE FROM numbers WHERE id=$1", [req.params.id]);
  res.sendStatus(200);
});

// ======================
// FRONTEND
// ======================
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>SMS Dashboard</title>

<style>
body {
  font-family: Arial;
  background: #0f172a;
  color: white;
  margin: 0;
  padding: 20px;
}

h1 {
  color: #38bdf8;
}

.card {
  background: #1e293b;
  padding: 15px;
  border-radius: 10px;
  margin-bottom: 20px;
}

input {
  padding: 10px;
  border-radius: 6px;
  border: none;
  margin-right: 10px;
}

button {
  padding: 10px 15px;
  border: none;
  border-radius: 6px;
  background: #38bdf8;
  color: black;
  cursor: pointer;
}

button:hover {
  background: #0ea5e9;
}

ul {
  list-style: none;
  padding: 0;
}

li {
  background: #334155;
  margin-bottom: 10px;
  padding: 10px;
  border-radius: 8px;
}
</style>
</head>

<body>

<h1>📩 SMS Dashboard</h1>

<div class="card">
  <h2>Добавить номер</h2>
  <input id="phone" placeholder="+79999999999"/>
  <button onclick="addNumber()">Добавить</button>
</div>

<div class="card">
  <h2>📱 Номера</h2>
  <ul id="numbers"></ul>
</div>

<div class="card">
  <h2>💬 Сообщения</h2>
  <ul id="messages"></ul>
</div>

<script>
const API = "/api";

async function load() {
  const [msgsRes, numsRes] = await Promise.all([
    fetch(API + "/messages"),
    fetch(API + "/numbers")
  ]);

  const msgs = await msgsRes.json();
  const nums = await numsRes.json();

  document.getElementById("messages").innerHTML =
    msgs.map(m => \`
      <li>
        <b>\${m.sender}</b> → \${m.receiver}<br/>
        \${m.text}<br/>
        <small>\${new Date(m.date).toLocaleString()}</small>
      </li>
    \`).join("");

  document.getElementById("numbers").innerHTML =
    nums.map(n => \`
      <li>
        \${n.phone}
        <button onclick="del(\${n.id})">❌</button>
      </li>
    \`).join("");
}

async function addNumber() {
  const phone = document.getElementById("phone").value;

  await fetch(API + "/numbers", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ phone })
  });

  document.getElementById("phone").value = "";
  load();
}

async function del(id) {
  await fetch(API + "/numbers/" + id, { method: "DELETE" });
  load();
}

setInterval(load, 3000);
load();
</script>

</body>
</html>
  `);
});

// ======================
// START
// ======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on " + PORT));
