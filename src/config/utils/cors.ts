const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = process.env.CORS_URLS.split('|');
        if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
};

export default corsOptions;
