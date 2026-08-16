/* ============================================================
   FILE: utils/apiResponse.js  —  Standardised API Responses
   ============================================================ */
// utils/apiResponse.js

const successResponse = (res, statusCode = 200, message = 'Success', data = {}) => {
  const payload = {
    success: true,
    message,
    data,
  };

  /* Backward-compatible auth shape for legacy clients such as Admin.
     The canonical response remains payload.data.user, while payload.user
     mirrors the same object so older frontend checks do not reject a valid
     authenticated/admin session. */
  if (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Object.prototype.hasOwnProperty.call(data, 'user')
  ) {
    payload.user = data.user;
  }

  return res.status(statusCode).json(payload);
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
