export default function handler(req, res) {
  res.status(200).json({ message: '안녕하세요', from: 'next-api' });
}
