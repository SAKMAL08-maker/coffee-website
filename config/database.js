const mongoose = require("mongoose");

async function connectDatabase() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error("MONGODB_URI is required to connect to the database.");
    }

    await mongoose.connect(uri);
    console.log("Connected to MongoDB.");
    return mongoose.connection;
}

module.exports = connectDatabase;
