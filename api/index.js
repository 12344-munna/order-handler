// This is the main function Vercel will run for any request to /api
module.exports = async (req, res) => {
  // --- This is the VERY FIRST thing the code will do ---
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] --- REQUEST RECEIVED! ---`);
  console.log(`METHOD: ${req.method}`);
  console.log(`URL: ${req.url}`);

  // We will now just respond with "OK" and do nothing else.
  // This removes all other code that could possibly fail.

  res.status(200).send("OK");
};
