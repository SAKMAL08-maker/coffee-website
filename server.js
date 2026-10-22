require('dotenv').config(); 
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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
    } 
    else if (req.url === '/api/orders' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });

        req.on('end', async () => {
            try {
                const orderData = JSON.parse(body);
                if (!orderData.deliveryAddress || orderData.deliveryAddress.trim() === '' || parseInt(orderData.selectedVolume) > 250) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ 
                        status: "Rejected", 
                        message: "Validation Error: Invalid delivery coordinates or volumetric fluid overflow!" 
                    }));
                }
                const { data, error } = await supabase
                    .from('orders')
                    .insert([
                        { 
                            deliveryAddress: orderData.deliveryAddress, 
                            selectedVolume: parseInt(orderData.selectedVolume) 
                        }
                    ], { Returning: 'minimal' });

                if (error) {
                    throw error;
                }

                console.log(`\n📦 Success! New Order saved into Supabase for: ${orderData.deliveryAddress}`);

                res.writeHead(200, { 'Content-Type': 'application/json', 'Connection': 'close' });
                res.end(JSON.stringify({ 
                    status: "Success", 
                    message: "Order dispatched to the Coffee Lab delivery queue and saved to Supabase!" 
                }));

            } catch (error) {
                console.error("🔴 REAL BACKEND CRASH ERROR:", error); 
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: "Error", message: "Failed to parse data payload or upload data parameters." }));
            }
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Error 404: Resource asset endpoint signature not found.');
    }
});

server.listen(PORT, () => {
    console.log(`Coffee Lab server running locally on http://localhost:${PORT}`);
});
