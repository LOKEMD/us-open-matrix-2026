const express = require('express');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname), { extensions: ['html'] }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const port = process.env.PORT || 8765;
app.listen(port, () => console.log(`U.S. Open Matrix pool running on ${port}`));
