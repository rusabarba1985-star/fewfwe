<?php
// ==================== ДЛЯ RAILWAY: ПОДКЛЮЧЕНИЕ К ПЕРСИСТЕНТНОМУ ТОМУ ====================
// Если существует папка /data (подключен persistent disk), используем её для БД
$data_dir = '/data';
if (!is_dir($data_dir) || !is_writable($data_dir)) {
    // fallback на локальную папку (для локальной разработки)
    $data_dir = __DIR__;
}
$db_file = $data_dir . '/exolve.db';

// ==================== ОБРАБОТКА ВЕБХУКА ====================
$is_webhook = false;
$raw_input = file_get_contents('php://input');
if ($raw_input && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode($raw_input, true);
    if ($data && (isset($data['to']) || isset($data['destination']))) {
        $is_webhook = true;
    }
}

// Подключение к БД (SQLite)
try {
    $pdo = new PDO("sqlite:$db_file");
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec("CREATE TABLE IF NOT EXISTS numbers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number_id INTEGER NOT NULL,
        sender TEXT,
        text TEXT NOT NULL,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (number_id) REFERENCES numbers(id) ON DELETE CASCADE
    )");
} catch (PDOException $e) {
    if ($is_webhook) {
        http_response_code(500);
        echo "DB error";
    } else {
        die("Database error: " . $e->getMessage());
    }
    exit;
}

// Если это вебхук — обрабатываем и выходим
if ($is_webhook) {
    $phone_number = null;
    $message_text = null;
    $sender = null;

    if (isset($data['to'])) {
        $phone_number = preg_replace('/[^0-9]/', '', $data['to']);
        $message_text = $data['text'] ?? '';
        $sender = $data['from'] ?? '';
    } elseif (isset($data['destination'])) {
        $phone_number = preg_replace('/[^0-9]/', '', $data['destination']);
        $message_text = $data['body'] ?? '';
        $sender = $data['source'] ?? '';
    }

    if ($phone_number && $message_text) {
        $stmt = $pdo->prepare("SELECT id FROM numbers WHERE phone = ?");
        $stmt->execute([$phone_number]);
        $number = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($number) {
            $stmt = $pdo->prepare("INSERT INTO messages (number_id, sender, text) VALUES (?, ?, ?)");
            $stmt->execute([$number['id'], $sender, $message_text]);
            http_response_code(200);
            echo "OK";
        } else {
            http_response_code(200);
            echo "Number not found";
        }
    } else {
        http_response_code(400);
        echo "Missing data";
    }
    exit;
}

// ==================== ИНТЕРФЕЙС ====================
// Добавление номера
$success = $error = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['add_number'])) {
    $phone = preg_replace('/[^0-9]/', '', $_POST['phone']);
    if (strlen($phone) >= 10) {
        try {
            $stmt = $pdo->prepare("INSERT INTO numbers (phone) VALUES (?)");
            $stmt->execute([$phone]);
            $success = "Номер $phone добавлен";
        } catch (PDOException $e) {
            $error = "Ошибка: номер уже существует";
        }
    } else {
        $error = "Введите корректный номер (только цифры)";
    }
}

// Удаление номера
if (isset($_GET['delete'])) {
    $id = (int)$_GET['delete'];
    $stmt = $pdo->prepare("DELETE FROM numbers WHERE id = ?");
    $stmt->execute([$id]);
    $success = "Номер удалён";
}

$numbers = $pdo->query("SELECT * FROM numbers ORDER BY id DESC")->fetchAll(PDO::FETCH_ASSOC);

$selected_number = null;
$messages = [];
if (isset($_GET['view_id'])) {
    $selected_id = (int)$_GET['view_id'];
    $stmt = $pdo->prepare("SELECT * FROM numbers WHERE id = ?");
    $selected_number = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($selected_number) {
        $stmt_msg = $pdo->prepare("SELECT * FROM messages WHERE number_id = ? ORDER BY received_at DESC");
        $stmt_msg->execute([$selected_id]);
        $messages = $stmt_msg->fetchAll(PDO::FETCH_ASSOC);
    }
}

$webhook_url = (isset($_SERVER['HTTPS']) ? 'https://' : 'http://') . $_SERVER['HTTP_HOST'] . $_SERVER['SCRIPT_NAME'];
?>
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>SMS приёмник — МТС Exolve</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body>
<div class="container mt-4">
    <h1 class="mb-4">📨 Управление номерами Exolve</h1>
    <?php if ($success): ?>
        <div class="alert alert-success"><?= htmlspecialchars($success) ?></div>
    <?php endif; ?>
    <?php if ($error): ?>
        <div class="alert alert-danger"><?= htmlspecialchars($error) ?></div>
    <?php endif; ?>
    <div class="row">
        <div class="col-md-5">
            <div class="card mb-4">
                <div class="card-header">➕ Добавить номер (вручную)</div>
                <div class="card-body">
                    <form method="post">
                        <div class="mb-3">
                            <label class="form-label">Номер телефона (например, 79601234567)</label>
                            <input type="text" name="phone" class="form-control" required>
                        </div>
                        <button type="submit" name="add_number" class="btn btn-primary">Добавить</button>
                    </form>
                </div>
            </div>
            <div class="card">
                <div class="card-header">📞 Ваши номера (<?= count($numbers) ?>/300)</div>
                <div class="list-group list-group-flush">
                    <?php if (empty($numbers)): ?>
                        <div class="list-group-item text-muted">Нет номеров. Добавьте первый.</div>
                    <?php else: ?>
                        <?php foreach ($numbers as $num): ?>
                            <div class="list-group-item d-flex justify-content-between">
                                <a href="?view_id=<?= $num['id'] ?>">+<?= htmlspecialchars($num['phone']) ?></a>
                                <a href="?delete=<?= $num['id'] ?>" class="btn btn-sm btn-danger" onclick="return confirm('Удалить номер?')">🗑</a>
                            </div>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </div>
            </div>
        </div>
        <div class="col-md-7">
            <?php if ($selected_number): ?>
                <div class="card">
                    <div class="card-header">
                        💬 Сообщения для +<?= htmlspecialchars($selected_number['phone']) ?>
                        <a href="?" class="btn btn-sm btn-secondary float-end">← Назад</a>
                    </div>
                    <div class="card-body" style="max-height:500px; overflow:auto;">
                        <?php if (empty($messages)): ?>
                            <p class="text-muted">Нет входящих SMS.</p>
                        <?php else: ?>
                            <?php foreach ($messages as $msg): ?>
                                <div class="border-bottom mb-2 pb-2">
                                    <small><?= date('d.m.Y H:i:s', strtotime($msg['received_at'])) ?></small>
                                    <?php if ($msg['sender']): ?>
                                        <div>От: <?= htmlspecialchars($msg['sender']) ?></div>
                                    <?php endif; ?>
                                    <div><?= nl2br(htmlspecialchars($msg['text'])) ?></div>
                                </div>
                            <?php endforeach; ?>
                        <?php endif; ?>
                    </div>
                </div>
            <?php else: ?>
                <div class="alert alert-info">Выберите номер, чтобы увидеть входящие SMS.</div>
            <?php endif; ?>
        </div>
    </div>
    <hr>
    <div class="text-muted small">
        <strong>Webhook URL (укажите в Exolve):</strong> <code><?= $webhook_url ?></code><br>
        Метод POST, ожидается JSON.
    </div>
</div>
</body>
</html>
