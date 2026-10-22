// 1. Load the tools
const express = require("express");
const cors = require("cors");
const mqtt = require("mqtt");

// 2. Create the server
const app = express();
app.use(cors());
app.use(express.json());

// 3. MQTT settings (the drone and the server talk through this)
const PREFIX = "medicinedrone/chinmayee25";
const mqttClient = mqtt.connect("mqtt://broker.hivemq.com:1883");

mqttClient.on("connect", () => {
  console.log("Connected to MQTT broker");
  mqttClient.subscribe(PREFIX + "/drone/+/telemetry");
});

// 4. Temporary data (stored in memory; a real database comes later)
const medicines = [
  { id: 1, name: "Insulin", stock: 20 },
  { id: 2, name: "Epinephrine", stock: 15 },
  { id: 3, name: "Paracetamol", stock: 100 },
];

const drones = [
  { id: "D1", status: "available", battery: 95, lat: 17.385, lng: 78.4867 },
  { id: "D2", status: "available", battery: 80, lat: 17.4, lng: 78.5 },
];

const orders = [];

// 5. Live updates arriving from the drone
mqttClient.on("message", (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const drone = drones.find((d) => d.id === data.droneId);
    if (!drone) return;

    drone.lat = data.lat;
    drone.lng = data.lng;
    drone.battery = data.battery;
    drone.status = data.status === "available" ? "available" : "in-flight";

    const order = orders.find((o) => o.id === data.orderId);
    if (order) {
      if (data.status === "flying") order.status = "In Flight";
      if (data.status === "delivered") order.status = "Delivered";
    }
  } catch (err) {
    console.log("Bad telemetry message:", err.message);
  }
});

// 6. Home page: checks that the server is working
app.get("/", (req, res) => {
  res.json({ message: "Medicine Drone API is running" });
});

// 7. See all medicines
app.get("/api/medicines", (req, res) => {
  res.json(medicines);
});

// 8. See all drones (position and battery update live)
app.get("/api/drones", (req, res) => {
  res.json(drones);
});

// 9. Create a new emergency order
app.post("/api/orders", (req, res) => {
  const { medicineId, quantity, urgency, lat, lng } = req.body;

  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "lat and lng must be numbers" });
  }

  const medicine = medicines.find((m) => m.id === medicineId);
  if (!medicine) {
    return res.status(404).json({ error: "Medicine not found" });
  }

  if (medicine.stock < quantity) {
    return res.status(400).json({ error: "Not enough stock" });
  }

  const drone = drones.find((d) => d.status === "available" && d.battery > 30);
  if (!drone) {
    return res.status(503).json({ error: "No drone available" });
  }

  medicine.stock = medicine.stock - quantity;
  drone.status = "in-flight";

  const order = {
    id: orders.length + 1,
    medicineId: medicineId,
    quantity: quantity,
    urgency: urgency || "normal",
    destination: { lat: lat, lng: lng },
    droneId: drone.id,
    status: "Assigned",
    createdAt: new Date().toISOString(),
  };
  orders.push(order);

  // Send the flight command to the drone
  mqttClient.publish(
    PREFIX + "/drone/" + drone.id + "/command",
    JSON.stringify({ orderId: order.id, lat: lat, lng: lng })
  );

  res.status(201).json(order);
});

// 10. See all orders
app.get("/api/orders", (req, res) => {
  res.json(orders);
});

// 11. Start the server
const PORT = 5001;
app.listen(PORT, (error) => {
  if (error) {
    console.log("Could not start server:", error.message);
    return;
  }
  console.log("Server running on http://localhost:" + PORT);
});