// The main function Vercel will run for any request to /api
module.exports = async (req, res) => {
  // --- This is the VERY FIRST thing the code will do ---
  console.log(`--- Request Received --- Method: ${req.method}, URL: ${req.url}`);

  try {
    // --- Part 1: Handle Facebook's Verification Request (GET) ---
    if (req.method === "GET") {
      const VERIFY_TOKEN = "munna12345";
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("Verification successful. Responding with challenge.");
        res.status(200).send(challenge);
      } else {
        console.error("Verification FAILED. Token mismatch.");
        res.status(403).send("Forbidden");
      }
      return;
    }

    // --- Part 2: Handle ANY Message from Facebook (POST) ---
    if (req.method === "POST") {
      console.log("Received POST data. Body:", JSON.stringify(req.body, null, 2));

      // We will stop here. We are not trying to connect to the database yet.
      // We just want to see if we can receive the message.

      res.status(200).send("EVENT_RECEIVED");
      return;
    }

    // If the request is not GET or POST, send an error
    res.status(405).send("Method Not Allowed");

  } catch (error) {
    console.error("--- A FATAL ERROR OCCURRED ---");
    console.error("Error Message:", error.message);
    console.error("Error Stack:", error.stack);
    res.status(500).send("Internal Server Error");
  }
};
