Module.register("MMM-MarineTraffic", {
  defaults: {
    maximumEntries: 10,
    purgeAfter: 600, // seconds
    lat: 51.011998,
    lon: 1.488079,
    lat1: null,
    lat2: null,
    lon1: null,
    lon2: null,
    radius: 30, // km
    underwayOnly: false,
    preciseCompass: false,
    highlightApproaching: false,
    highlightWithin: null,
    apiKey: ""
  },

  getStyles() {
    return [this.file("marinetraffic.css")];
  },

  start: function () {
    var self = this;

    self.boats = [];
    self.error = "";
    self.connected = false;
    self.connecting = false;

    // if an explicit rectangle hasn't been provided, create one based on a center point and distance
    if (!self.config.lat1 || !self.config.lon1 || !self.config.lat2 || !self.config.lon2) {
      self.config.lat1 = self.config.lat - (self.config.radius * 0.00904371733);
      self.config.lat2 = self.config.lat + (self.config.radius * 0.00904371733);
      self.config.lon1 = self.config.lon - (self.config.radius * 0.008983111750 / Math.cos(self.config.lat * 0.01745329252));
      self.config.lon2 = self.config.lon + (self.config.radius * 0.008983111750 / Math.cos(self.config.lat * 0.01745329252));
    } else {
      self.lat = (self.config.lat1 + self.config.lat2) / 2;
      self.lon = (self.config.lon1 + self.config.lon2) / 2;
    }

    self.resume();
  },

  suspend: function () {
    var self = this;

    self.stopIntervals();
    self.sendDisconnect();
  },

  resume: function () {
    var self = this;

    self.sendConnect();
    self.startIntervals();
  },

  getDom: function () {
    var self = this;

    const wrapper = document.createElement("table");
    wrapper.className = "MMM-MarineTraffic-Table";

    if (self.error) {
      wrapper.innerHTML = self.error;
      wrapper.className += " dimmed";
      return wrapper;
    } else if (self.connecting) {
      wrapper.innerHTML = "Connecting...";
      wrapper.className += " dimmed";
      return wrapper;
    }

    let count = 0;
    for (let k = 0; k < self.boats.length && count < self.config.maximumEntries; k++) {
      let boat = self.boats[k];

      if (self.config.underwayOnly && !boat.underway) {
        continue;
      }

      let row = document.createElement("tr");

      let statusCell = document.createElement("td");
      statusCell.className = "MMM-MarineTraffic-Status dimmed";
      let icon = document.createElement("img");
      if (boat.underway) {
        icon.setAttribute("src", self.file("navigation.svg"));
        icon.style.rotate = `${boat.course.toFixed(0)}deg`;
      } else {
        icon.setAttribute("src", self.file("anchor.svg"));
      }
      statusCell.appendChild(icon);
      row.appendChild(statusCell);

      let nameCell = document.createElement("td");
      let colorClass = "bright";
      if (self.config.highlightApproaching) {
        if (boat.underway) {
          const color = ["dimmed", "", "bright", "bright", "", "dimmed"];
          colorClass = color[(Math.abs(boat.direction - boat.course)/60).toFixed() % 6];
        } else {
          colorClass = "";
        }
      }
      if (self.config.highlightWithin > 0) {
        if (self.config.highlightApproaching) {
          if (boat.distance > self.config.highlightWithin && colorClass == "bright") {
            colorClass = "";
          }
        } else if (boat.distance > self.config.highlightWithin) {
          colorClass = "dimmed";
        }
      }
      nameCell.className = "MMM-MarineTraffic-Name " + colorClass;
      nameCell.innerHTML = boat.name;
      row.appendChild(nameCell);

      let distanceCell = document.createElement("td");
      distanceCell.className = "MMM-MarineTraffic-Distance dimmed";
      let heading = "";
      const compass = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
      if (self.config.preciseCompass) {
        heading = compass[(boat.direction * 16 / 360).toFixed() % 16];
      } else {
        heading = compass[((boat.direction * 8 / 360).toFixed() % 8) * 2];
      }
      distanceCell.innerHTML = `${boat.distance.toFixed(1)} km ${heading}`;
      row.appendChild(distanceCell);

      wrapper.appendChild(row);
      count++;
    }

    return wrapper;
  },

  socketNotificationReceived: function (notification, payload) {
    var self = this;

    if (notification === "ERROR") {
      self.error = payload;
      self.updateDom();
    } else if (notification === "CONNECTED") {
      self.connected = true;
      self.connecting = false;
    } else if (notification === "DISCONNECTED") {
      self.connected = false;
      self.connecting = false;
    } else if (notification === "POSITION") {
      self.error = "";
      let found = false;
      for (let k = 0; k < self.boats.length; k++) {
        if (self.boats[k].mmsi == payload.mmsi) {
          found = true;
          if (payload.timestamp > self.boats[k].timestamp) {
            self.boats[k] = payload;
          }
        }
      }

      if (!found) {
        self.boats.push(payload);
      }

      self.boats.sort(function (a, b) {
        return a.distance - b.distance;
      });

      self.updateDom();
    }
  },

  purge: function () {
    var self = this;

    let dirty = false;
    let now = new Date().getTime();
    for (let k = self.boats.length - 1; k >= 0; k--) {
      if (now - self.boats[k].timestamp >= self.config.purgeAfter * 1000) {
        self.boats.splice(k, 1);
        dirty = true;
      }
    }

    if (dirty) {
      self.updateDom();
    }
  },

  connectionMonitor: function () {
    var self = this;

    if (!self.connected) {
      if (self.connecting) {
        self.connectRequestTimer++;

        if (self.connectRequestTimer == 10) {
          self.updateDom();
        }

        if (self.connectRequestTimer >= 60) {
          self.resume();
        }
      } else {
        self.resume();
      }
    }
  },

  startIntervals: function () {
    var self = this;

    self.stopIntervals();

    self.purgeInterval = setInterval(function () { self.purge(); }, 10000);
    self.connectionInterval = setInterval(function () { self.connectionMonitor(); }, 1000);
  },

  stopIntervals: function () {
    var self = this;

    if (self.purgeInterval) {
      clearInterval(self.purgeInterval);
      self.purgeInterval = undefined;
    }

    if (self.connectionInterval) {
      clearInterval(self.connectionInterval);
      self.connectionInterval = undefined;
    }
  },

  sendConnect: function () {
    var self = this;

    self.connecting = true;
    self.connectRequestTimer = 0;
    self.sendSocketNotification("CONNECT", { "config": self.config });
  },

  sendDisconnect: function () {
    var self = this;

    self.sendSocketNotification("DISCONNECT");
  },

});
