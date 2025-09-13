const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// 静态文件服务
app.use(express.static(path.join(__dirname, 'dist')));

// 路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.get('/dapp', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'dapp.html'));
});

app.get('/wallet', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'wallet.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
