const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.CORS_URLS.split("|");
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      console.error(
        `[CORS Block] A origem '${origin}' tentou acessar a API mas não está na lista de permitidos (CORS_URLS).`,
      );
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

export default corsOptions;
