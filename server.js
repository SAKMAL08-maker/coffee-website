const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error: Missing index.html layout file.');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(content);
            }
        });
    } else if (req.url === '/api/orders' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const orderData = JSON.parse(body);
                if (!orderData.deliveryAddress || orderData.deliveryAddress.trim() === '' || parseInt(orderData.selectedVolume) > 250) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ 
                        status: "Rejected", 
                        message: "Validation Error: Invalid delivery coordinates or volumetric fluid overflow!" 
                    }));
                }

                console.log("\n==================================================");
                console.log("🧪 COFFEE LAB TRANSACTION PROCESSING STATION");
                console.log("==================================================");
                console.log(`Fulfillment Target : DELIVERING COFFEE`);
                console.log(`Destination Address: ${orderData.deliveryAddress}`);
                console.log(`Selected Volume    : ${orderData.selectedVolume}`);
                console.log(`Mug Fluid Capacity : ${orderData.selectedVolume} / 250ml`);
                console.log("==================================================\n");
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    status: "Success", 
                    message: "Order dispatched to the Coffee Lab delivery queue successfully!" 
                }));

            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: "Error", message: "Corrupted request payload format data parameters." }));
            }
        });

    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Error 404: Resource asset endpoint signature not found.');
    }
});

server.listen(PORT, () => {
    console.log(`Coffee Lab instance initialized! Open up your browser link at https://coffee-lab-4-coffee-lovers.onrender.com/`);
    console.log(`Server is also running locally on http://localhost:${PORT}`);
});
