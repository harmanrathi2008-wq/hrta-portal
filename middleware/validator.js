import { body, validationResult } from 'express-validator';

// Sanitization & Validation rules for email inputs
export const validateEmailInput = [
  body('email')
    .trim()
    .isEmail().withMessage('Please enter a valid email address.')
    .normalizeEmail()
    .escape(),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }
    next();
  }
];

// Sanitization rules for general text inputs (preventing XSS scripts)
export const sanitizeTextInput = (fieldName) => [
  body(fieldName)
    .trim()
    .escape(),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: `Invalid input characters detected in ${fieldName}.` });
    }
    next();
  }
];
