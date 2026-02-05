const fs = require("fs");

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node scripts/openapi/patch-postman.js <collection.json>");
  process.exit(1);
}

const collection = JSON.parse(fs.readFileSync(filePath, "utf8"));

const prerequest = {
  listen: "prerequest",
  script: {
    type: "text/javascript",
    exec: [
      "const token = pm.environment.get('bearer_token') || pm.globals.get('bearer_token') || pm.collectionVariables.get('bearer_token');",
      "if (token) {",
      "  pm.request.headers.upsert({ key: 'Authorization', value: `Bearer ${token}` });",
      "}",
    ],
  },
};

collection.event = (collection.event || []).filter(
  (event) => event.listen !== "prerequest"
);
collection.event.push(prerequest);

fs.writeFileSync(filePath, JSON.stringify(collection, null, 2), "utf8");
