require('dotenv').config();

const app = require('./src/server/app');

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Exam Tracker backend running on port ${PORT}`);
});
