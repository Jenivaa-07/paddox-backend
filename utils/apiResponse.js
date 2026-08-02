
/* ============================================================
   FILE: utils/apiResponse.js  —  Standardised API Responses
   ============================================================ */
// utils/apiResponse.js

const successResponse = (res, statusCode = 200, message = 'Success', data = {}) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

const errorResponse = (res, statusCode = 500, message = 'Server error') => {
  return res.status(statusCode).json({
    success: false,
    message,
  });
};

const paginatedResponse = (res, data, page, limit, total) => {
  return res.status(200).json({
    success    : true,
    count      : data.length,
    total,
    page       : parseInt(page),
    pages      : Math.ceil(total / limit),
    hasNext    : page * limit < total,
    hasPrev    : page > 1,
    data,
  });
};

module.exports = { successResponse, errorResponse, paginatedResponse };
