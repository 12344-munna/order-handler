const admin = require('firebase-admin');
const axios = require('axios'); // Tool for sending messages

// ======================================================================
// PASTE YOUR FIREBASE USER ID HERE
// ======================================================================
const YOUR_ADMIN_USER_ID = "3yd2vXmTpLZjvsgzPvH7dc8yjKi2";
// ======================================================================

// Securely Initialize Firebase Admin SDK
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY))
    });
  } catch (error) {
    console.error('Firebase admin initialization error', error.stack);
  }
}
const db = admin.firestore();

// --- Helper function for sending a reply message ---
async function sendReply(customerId, messageText) {
  const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) {
    console.error("FB_PAGE_ACCESS_TOKEN is not set.");
    return;
  }
  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  const payload = {
    recipient: { id: customerId },
    message: { text: messageText },
    messaging_type: "RESPONSE"
  };
  try {
    await axios.post(url, payload);
    console.log(`Reply sent to customer ${customerId}`);
  } catch (error) {
    console.error('Failed to send reply:', error.response ? error.response.data : error.message);
  }
}

// --- Main function that handles all requests ---
module.exports = async (req, res) => {
  if (req.method === "GET") {
    // Standard webhook verification
    const VERIFY_TOKEN = "munna12345";
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.status(403).send("Forbidden");
    }
    return;
  }

  if (req.method === "POST") {
    const body = req.body;
    if (body.object === "page") {
      for (const entry of body.entry) {
        const webhookEvent = entry.messaging[0];
        const senderId = webhookEvent.sender.id; // The customer's unique Facebook ID
        const messageText = webhookEvent.message ? webhookEvent.message.text : "";
        const lowerCaseMessage = messageText.toLowerCase();

        // --- ROUTE 1: Handle Stock Check Command ---
        if (lowerCaseMessage.startsWith("/available:")) {
          console.log("Stock check command detected.");
          try {
            const productCodes = lowerCaseMessage.replace("/available:", "").split(",").map(code => code.trim());
            let replyMessage = "Stock Report:\n\n";

            for (const code of productCodes) {
              if(!code) continue; // Skip if a code is empty (e.g., from a trailing comma)
              const productQuery = await db.collection("products")
                .where("productCode", "==", code)
                .limit(1)
                .get();

              if (productQuery.empty) {
                replyMessage += `• Product ${code}: Not Found\n`;
              } else {
                const productData = productQuery.docs[0].data();
                const stockDetails = Object.entries(productData.sizes || {})
                  .map(([size, qty]) => `${size.toUpperCase()}: ${qty}`)
                  .join(', ');
                replyMessage += `• ${productData.name} (Code: ${code}):\n  ${stockDetails || 'No sizes specified.'}\n\n`;
              }
            }
            await sendReply(senderId, replyMessage.trim());
          } catch (error) {
            console.error("Error checking stock:", error.message);
            await sendReply(senderId, "Sorry, there was an error checking the stock.");
          }
        }
        
        // --- ROUTE 2: Handle Tracking Link Command ---
        else if (lowerCaseMessage.startsWith("/trackinglink")) {
            console.log("Tracking link command detected.");
            try {
                // Find the latest shipped order for this specific customer
                const orderQuery = await db.collection("pendingOrders")
                    .where("customerFbId", "==", senderId)
                    .where("status", "in", ["shipped", "delivered"]) // Look for orders that have a tracking link
                    .orderBy("createdAt", "desc") // Get the most recent one
                    .limit(1)
                    .get();

                if (orderQuery.empty) {
                    await sendReply(senderId, "Sorry, we couldn't find a shipped order for you to track.");
                } else {
                    const orderData = orderQuery.docs[0].data();
                    const courierName = orderData.courierName || 'your courier';
                    const trackingCode = orderData.courierTrackingCode || orderData.steadfastConsignmentId;
                    
                    if (!trackingCode) {
                         await sendReply(senderId, "Your latest order has been processed, but the tracking link is not available yet. Please check again later.");
                    } else {
                        let trackingUrl;
                        if (courierName.toLowerCase() === 'pathao') {
                            trackingUrl = `https://merchant.pathao.com/tracking?consignment_id=${trackingCode}&phone=${orderData.phone}`;
                        } else {
                            trackingUrl = `https://steadfast.com.bd/t/${trackingCode}`;
                        }
                        const replyMessage = `Hello ${orderData.customerName},\n\nHere is the tracking link for your latest order:\n${trackingUrl}`;
                        await sendReply(senderId, replyMessage);
                    }
                }
            } catch (error) {
                 console.error("Error sending tracking link:", error.message);
                 await sendReply(senderId, "Sorry, there was an error fetching your tracking link.");
            }
        }

        // --- ROUTE 3: Handle Order Confirmation Command ---
        else if (lowerCaseMessage.includes("/confirmation")) {
           try {
            const orderData = parseOrderDetails(messageText);
            await db.runTransaction(async (transaction) => {
              const inventoryUpdates = [];
              const orderItems = [];
              let totalCostOfGoods = 0;
              for (const code of orderData.productCodes) {
                const [productCode, size] = code.split("-");
                if (!productCode || !size) throw new Error(`Invalid code format: ${code}`);
                const inventoryQuery = db.collection("products").where("productCode", "==", productCode.trim()).limit(1);
                const productSnapshot = await transaction.get(inventoryQuery);
                if (productSnapshot.empty) throw new Error(`Product not found for code: ${productCode}`);
                const productDoc = productSnapshot.docs[0];
                const productData = productDoc.data();
                const currentSizes = productData.sizes || {};
                const sizeKey = size.trim().toUpperCase();
                if (!currentSizes[sizeKey] || currentSizes[sizeKey] <= 0) {
                  throw new Error(`Product ${productData.name} (Size: ${sizeKey}) is out of stock.`);
                }
                currentSizes[sizeKey] -= 1;
                const newTotalStock = Object.values(currentSizes).reduce((a, b) => a + b, 0);
                inventoryUpdates.push({ ref: productDoc.ref, update: { sizes: currentSizes, availableAmount: newTotalStock } });
                totalCostOfGoods += productData.buyingPrice || 0;
                orderItems.push({ productId: productDoc.id, productName: productData.name, selectedSizesAndQuantities: { [sizeKey]: 1 }, unitSellingPrice: productData.sellingPrice, itemTotalSellingPrice: productData.sellingPrice, unitBuyingPrice: productData.buyingPrice });
              }
              const profit = orderData.cod + orderData.paidInAdvance - totalCostOfGoods - orderData.deliveryCharge;
              for (const update of inventoryUpdates) {
                transaction.update(update.ref, update.update);
              }
              const newOrderRef = db.collection("pendingOrders").doc();
              transaction.set(newOrderRef, {
                customerName: orderData.name, customerAddress: orderData.address, phone: orderData.phone, items: orderItems,
                deliveryCharge: orderData.deliveryCharge, advancePaid: orderData.paidInAdvance, codAmount: orderData.cod,
                totalOrderPrice: orderData.cod, profit: profit, status: "pending", source: "Facebook-Admin",
                createdAt: admin.firestore.FieldValue.serverTimestamp(), orderDate: admin.firestore.FieldValue.serverTimestamp(),
                userId: YOUR_ADMIN_USER_ID, customerFbId: webhookEvent.sender.id,
              });
            });
          } catch (error) {
            console.error("Error processing admin order:", error.message);
          }
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
    return;
  }
  res.status(405).send("Method Not Allowed");
};

// Helper function to parse order details remains the same
function parseOrderDetails(text) {
  const details = {};
  const lines = text.split("\n");
  for (const line of lines) {
    const parts = line.split(":");
    if (parts.length < 2) continue;
    const key = parts[0].trim().toLowerCase();
    const value = parts.slice(1).join(":").trim();
    if (key === "name") details.name = value;
    if (key === "address") details.address = value;
    if (key === "phone") details.phone = value;
    if (key === "product code") {
      details.productCodes = value.split(",").map(code => code.trim());
    }
    if (key === "delivery charge") details.deliveryCharge = parseFloat(value) || 0;
    if (key === "paid in advance") details.paidInAdvance = parseFloat(value) || 0;
    if (key === "cod") details.cod = parseFloat(value) || 0;
  }
  return details;
}
