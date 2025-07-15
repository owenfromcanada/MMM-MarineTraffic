const NodeHelper = require("node_helper");
const WebSocket = require("ws");

module.exports = NodeHelper.create({

  socketNotificationReceived: function (notification, payload) {
    var self = this;
    if (notification === "CONNECT") {
      self.config = payload.config;
      self.connect();
    } else if (notification === "DISCONNECT") {
      self.disconnect();
    }
  },

  connect: function () {
    var self = this;
    self.disconnect();
    self.ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

    self.ws.onerror = function (event) {
      self.sendSocketNotification("ERROR", event.code);
    }

    self.ws.onopen = function (_) {
      let subscriptionMessage = JSON.stringify({
        Apikey: self.config.apiKey,
        BoundingBoxes: [[[self.config.lat1, self.config.lon1], [self.config.lat2, self.config.lon2]]],
        FilterMessageTypes: ["PositionReport"]
      });
      self.ws.send(subscriptionMessage);
      self.sendSocketNotification("CONNECTED");
    };

    self.ws.onclose = function (_) {
      self.sendSocketNotification("DISCONNECTED");
    };

    self.ws.onmessage = function (event) {
      let msg = null;
      try {
        msg = JSON.parse(event.data);
      } catch (error) {
        console.error("Error parsing AIS message: " + event.data);
        return;
      }

      if (msg.MessageType === 'PositionReport' && msg.Message.PositionReport.Valid) {
        let lat_d = (msg.Message.PositionReport.Latitude - self.config.lat) * 110.574;
        let lon_d = (msg.Message.PositionReport.Longitude - self.config.lon) * Math.cos(msg.Message.PositionReport.Latitude * 0.01745329252) * 111.32;
        let underway = (msg.Message.PositionReport.NavigationalStatus == 0 || msg.Message.PositionReport.NavigationalStatus == 8) &&
          (msg.Message.PositionReport.Sog >= 0.2);
        self.sendSocketNotification("POSITION", {
          "timestamp": new Date(msg.MetaData.time_utc).getTime(),
          "mmsi": msg.MetaData.MMSI,
          "name": msg.MetaData.ShipName.trim(),
          "lat": msg.Message.PositionReport.Latitude,
          "lon": msg.Message.PositionReport.Longitude,
          "distance": Math.sqrt((lat_d * lat_d) + (lon_d * lon_d)),
          "direction": lat_d == 0 ? (lon_d > 0 ? 90 : 270) : (Math.atan(lon_d / lat_d) * 57.29577951) + (lat_d < 0 ? 180 : (lon_d < 0 ? 360 : 0)),
          "course": msg.Message.PositionReport.Cog,
          "underway": underway
        });
      }
    };

  },

  disconnect: function () {
    var self = this;

    if (self.ws) {
      self.ws.onclose = undefined;
      self.ws.onerror = undefined;
      self.ws.onopen = undefined;
      self.ws.onmessage = undefined;

      if (self.ws.readyState === WebSocket.OPEN) {
        self.ws.close();
        self.ws.terminate();
      }
      self.ws = undefined;
    }
  },

});