const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Sajikan file statis dari folder public
app.use(express.static(path.join(__dirname, 'public')));

// Queue untuk user yang mencari stranger
let waitingQueue = [];

// Menyimpan mapping socket.id -> roomId
const userRooms = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // User mencari stranger
  socket.on('find_stranger', () => {
    // Cek jika user sudah dalam room
    if (userRooms.has(socket.id)) return;

    // Jika ada yang menunggu
    if (waitingQueue.length > 0) {
      const partnerId = waitingQueue.shift();
      
      // Pastikan partner masih terhubung
      if (!io.sockets.sockets.get(partnerId)) {
        waitingQueue.push(socket.id);
        socket.emit('waiting', 'Mencari stranger...');
        return;
      }

      const roomId = `room_${partnerId}_${socket.id}`;
      
      // Gabungkan keduanya ke room
      socket.join(roomId);
      io.sockets.sockets.get(partnerId).join(roomId);
      
      userRooms.set(socket.id, roomId);
      userRooms.set(partnerId, roomId);

      io.to(roomId).emit('matched', roomId);
      console.log(`Matched ${partnerId} ↔ ${socket.id}`);
    } else {
      // Masukkan ke antrian
      waitingQueue.push(socket.id);
      socket.emit('waiting', 'Mencari stranger...');
    }
  });

  // Kirim pesan
  socket.on('send_message', (data) => {
    const roomId = userRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit('receive_message', {
        text: data.text,
        sender: socket.id
      });
    }
  });

  // Typing indicator
  socket.on('typing', () => {
    const roomId = userRooms.get(socket.id);
    if (roomId) socket.to(roomId).emit('partner_typing');
  });

  socket.on('stop_typing', () => {
    const roomId = userRooms.get(socket.id);
    if (roomId) socket.to(roomId).emit('partner_stop_typing');
  });

  // Report user
  socket.on('report_user', () => {
    const roomId = userRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit('reported');
      io.in(roomId).socketsLeave(roomId);
      userRooms.delete(socket.id);
      const partner = [...io.sockets.adapter.rooms.get(roomId) || []][0];
      if (partner) userRooms.delete(partner);
    }
    socket.emit('disconnected');
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // Hapus dari antrian jika masih menunggu
    waitingQueue = waitingQueue.filter(id => id !== socket.id);
    
    // Jika sedang dalam room
    const roomId = userRooms.get(socket.id);
    if (roomId) {
      socket.to(roomId).emit('stranger_disconnected');
      io.in(roomId).socketsLeave(roomId);
      userRooms.delete(socket.id);
      const partner = [...io.sockets.adapter.rooms.get(roomId) || []][0];
      if (partner) userRooms.delete(partner);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
