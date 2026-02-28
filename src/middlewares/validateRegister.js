const validateRegister = (req, res, next) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }

  const emailRegex = /\S+@\S+\.\S+/;

  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  next(); // pasa al controlador
};

module.exports = validateRegister;