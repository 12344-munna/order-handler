const admin = require('firebase-admin');

// Securely Initialize Firebase Admin SDK
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY))
    });
    console.log("Firebase Admin SDK initialized successfully.");
  } catch (error) {
    console.error('Firebase admin initialization error', error.stack);
  }
}
const db = admin.firestore();

// Helper function to parse your specific message format
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

// This is the main function Vercel will run for any request to /api
module.exports = async (req, res) => {
  // Part 1: Handle Facebook's Verification Request (GET)
  if (req.method === "GET") {
    console.log("Received GET request for webhook verification.");
    const VERIFY_TOKEN = "munna12345";
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("WEBHOOK_VERIFIED_SUCCESSFULLY");
      res.status(200).send(challenge);
    } else {
      console.error("Webhook verification failed. Token mismatch or missing mode.");
      res.status(403).send("Forbidden");
    }
    return;
  }

  // Part 2: Handle Admin's Order Message (POST)
  if (req.method === "POST") {
    console.log("Received POST request from Facebook.");
    const body = req.body;
    if (body.object === "page") {
      for (const entry of body.entry) {
        const webhookEvent = entry.messaging[0];
        const messageText = webhookEvent.message ? webhookEvent.message.text : "";

        if (messageText && messageText.toLowerCase().includes("/confirmation")) {
          console.log("--- START: Admin confirmation command detected ---");
          try {
            const orderData = parseOrderDetails(messageText);
            console.log("1. Parsed Order Details:", JSON.stringify(orderData, null, 2));

            await db.runTransaction(async (transaction) => {
              console.log("2. Starting Firestore Transaction.");
              const inventoryUpdates = [];
              const orderItems = [];
              let totalCostOfGoods = 0;

              for (const code of orderData.productCodes) {
                const [productCode, size] = code.split("-");
                if (!productCode || !size) throw new Error(`Invalid code format: ${code}`);
                
                console.log(`3. Searching for product with code: '${productCode.trim()}' in 'products' collection.`);
                const inventoryQuery = db.collection("products")
                  .where("productCode", "==", productCode.trim())
                  .limit(1);

                const productSnapshot = await transaction.get(inventoryQuery);
                if (productSnapshot.empty) {
                   console.error(`ERROR: Product not found in Firestore for code: '${productCode.trim()}'`);
                   throw new Error(`Product not found for code: ${productCode}`);
                }
                
                const productDoc = productSnapshot.docs[0];
                const productData = productDoc.data();
                console.log(`4. Found product: ${productData.name} (ID: ${productDoc.id})`);

                const currentSizes = productData.sizes || {};
                const sizeKey = size.trim().toUpperCase();

                if (!currentSizes[sizeKey] || currentSizes[sizeKey] <= 0) {
                  console.error(`ERROR: Product ${productData.name} (Size: ${sizeKey}) is out of stock.`);
                  throw new Error(`Product ${productData.name} (Size: ${sizeKey}) is out of stock.`);
                }
                console.log(`Stock OK for size ${sizeKey}. Current: ${currentSizes[sizeKey]}.`);
                
                currentSizes[sizeKey] -= 1;
                const newTotalStock = Object.values(currentSizes).reduce((a, b) => a + b, 0);

                inventoryUpdates.push({
                  ref: productDoc.ref,
                  update: { sizes: currentSizes, availableAmount: newTotalStock },
                });
                console.log(`5. Inventory update prepared for ${productDoc.id}. New stock: ${newTotalStock}`);

                totalCostOfGoods += productData.buyingPrice || 0;

                orderItems.push({
                  productId: productDoc.id,
                  productName: productData.name,
                  selectedSizesAndQuantities: { [sizeKey]: 1 },
                  unitSellingPrice: productData.sellingPrice,
                  itemTotalSellingPrice: productData.sellingPrice,
                  unitBuyingPrice: productData.buyingPrice,
                });
              }

              const profit = orderData.cod + orderData.paidInAdvance - totalCostOfGoods - orderData.deliveryCharge;

              for (const update of inventoryUpdates) {
                transaction.update(update.ref, update.update);
              }

              const newOrderRef = db.collection("pendingOrders").doc();
              console.log("6. Creating final order document in 'pendingOrders' collection.");
              transaction.set(newOrderRef, {
                customerName: orderData.name,
                customerAddress: orderData.address,
                phone: orderData.phone,
                items: orderItems,
                deliveryCharge: orderData.deliveryCharge,
                advancePaid: orderData.paidInAdvance,
                codAmount: orderData.cod,
                totalOrderPrice: orderData.cod,
                profit: profit,
                status: "pending",
                source: "Facebook-Admin",
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                orderDate: admin.firestore.FieldValue.serverTimestamp(),
                userId: webhookEvent.recipient.id,
              });
              console.log("7. Transaction instructions prepared successfully.");
            });
            console.log("--- SUCCESS: Transaction completed. ---");
          } catch (error) {
            console.error("--- ERROR: Order processing failed! ---");
            console.error("Error Message:", error.message);
            console.error("Error Stack:", error.stack);
          }
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
    return;
  }

  res.status(405).send("Method Not Allowed");
};
