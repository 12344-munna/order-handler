// This is the main function Vercel will run for any request to /api
module.exports = async (req, res) => {
  // --- Part 1: Handle Facebook's Verification Request (GET) ---
  if (req.method === "GET") {
    console.log("--- DEBUG: Received GET request for verification. ---");
    const VERIFY_TOKEN = "munna12345"; // Your secret token
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("--- DEBUG: Verification successful. Responding with challenge. ---");
      res.status(200).send(challenge);
    } else {
      console.error("--- DEBUG: Verification FAILED. Token mismatch or missing params. ---");
      res.status(403).send("Forbidden");
    }
    return;
  }

  // --- Part 2: Handle ANY Message from Facebook (POST) ---
  if (req.method === "POST") {
    console.log("--- DEBUG: Received a POST request from Facebook! ---");
    
    // Log the entire message body that Facebook sent.
    console.log("FULL MESSAGE BODY:", JSON.stringify(req.body, null, 2));

    res.status(200).send("EVENT_RECEIVED");
    return;
  }

  // If the request is not GET or POST, send an error
  res.status(405).send("Method Not Allowed");
};
