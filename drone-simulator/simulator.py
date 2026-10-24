import json
import queue
import sys
import time

import paho.mqtt.client as mqtt

DRONE_ID = sys.argv[1] if len(sys.argv) > 1 else "D1"
BASES = {"D1": (17.385, 78.4867), "D2": (17.4, 78.5)}
BASE_LAT, BASE_LNG = BASES.get(DRONE_ID, (17.385, 78.4867))

BROKER = "broker.hivemq.com"
PORT = 1883
PREFIX = "medicinedrone/chinmayee25"
COMMAND_TOPIC = f"{PREFIX}/drone/{DRONE_ID}/command"
TELEMETRY_TOPIC = f"{PREFIX}/drone/{DRONE_ID}/telemetry"
WEATHER_TOPIC = f"{PREFIX}/weather"

STEPS = 60           # small moves per trip
STEP_SECONDS = 0.5   # 60 x 0.5 = 30 seconds per trip

lat, lng = BASE_LAT, BASE_LNG
battery = 95.0 if DRONE_ID == "D1" else 80.0
raining = False
commands = queue.Queue()


def on_connect(client, userdata, flags, reason_code, properties):
    print("Connected to broker:", reason_code)
    client.subscribe(COMMAND_TOPIC)
    client.subscribe(WEATHER_TOPIC)
    print("Drone", DRONE_ID, "is waiting for orders...")


def on_message(client, userdata, msg):
    global raining
    data = json.loads(msg.payload.decode())
    if msg.topic == WEATHER_TOPIC:
        raining = bool(data.get("rain"))
        print("Rain mode:", raining)
    else:
        commands.put(data)


def send(client, status, order_id=None):
    data = {
        "droneId": DRONE_ID,
        "orderId": order_id,
        "lat": round(lat, 6),
        "lng": round(lng, 6),
        "battery": round(battery, 1),
        "status": status,
    }
    client.publish(TELEMETRY_TOPIC, json.dumps(data))
    print(status, "| lat", data["lat"], "lng", data["lng"], "battery", data["battery"])


def fly(client, to_lat, to_lng, status, order_id):
    global lat, lng, battery
    start_lat, start_lng = lat, lng
    for step in range(1, STEPS + 1):
        while raining:  # hold position until the rain stops
            send(client, "delayed", order_id)
            time.sleep(2)
        fraction = step / STEPS
        lat = start_lat + (to_lat - start_lat) * fraction
        lng = start_lng + (to_lng - start_lng) * fraction
        battery -= 0.2
        send(client, status, order_id)
        time.sleep(STEP_SECONDS)


client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_connect = on_connect
client.on_message = on_message
client.connect(BROKER, PORT, 60)
client.loop_start()

try:
    while True:
        try:
            order = commands.get(timeout=1)
        except queue.Empty:
            continue

        order_id = order.get("orderId")
        print("New order", order_id)

        fly(client, order["lat"], order["lng"], "flying", order_id)
        send(client, "delivered", order_id)
        time.sleep(3)

        fly(client, BASE_LAT, BASE_LNG, "returning", order_id)
        battery = 95.0  # recharged at base
        send(client, "available", order_id)
        print("Back at base. Waiting for the next order...")
except KeyboardInterrupt:
    print("Simulator stopped")
    client.loop_stop()