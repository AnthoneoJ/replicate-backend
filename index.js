const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
var fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;
const modelCode = process.env.MODEL_CODE || "50881b153b4d5f72b3db697e2bbad23bb1277ab741c5b52d80cd6ee17ea660e9";
const apiToken = process.env.REPLICATE_API_TOKEN;
const imgHostKey = process.env.IMAGE_HOST_KEY;
const debugMode = (process.env.DEBUG_MODE || 'false') === 'true';


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isValidHttpUrl(string) {
    let url;

    try {
        url = new URL(string);
    } catch (_) {
        return false;
    }

    return url.protocol === "http:" || url.protocol === "https:";
}

function saveJson(d, filename) {
    if (!debugMode) return;
    fs.writeFile(filename, JSON.stringify(d), function (err) {
        if (err) {
            console.log(err);
        }
    });
}


// Enable CORS.
app.use(cors()); // Enable all routes

// Parse req.body in POST, GET, etc.
app.use(bodyParser.json({ limit: '50mb' }));

// Handle POST requests to /api/predictions
app.post('/api/predictions', async (req, res) => {
    try {
        let imageUrlPromise;
        // Detect whether the input is a URL or path
        if (!isValidHttpUrl(req.body.image)) {
            // File
            const imgSource = req.body.image.split(',')[1];
            const fd = new FormData();
            fd.append("image", imgSource);
            fd.append("name", "temp_image");
            const hostUrl = `https://api.imgbb.com/1/upload?expiration=600&key=${imgHostKey}`;

            // Fetch the image data and resolve the promise when done
            imageUrlPromise = new Promise((resolve, reject) => {
                var jsonObject = {}; // Convert FormData to JSON for inspection
                fd.forEach(function (value, key) {
                    jsonObject[key] = value;
                });
                saveJson({ method: 'POST', body: jsonObject }, "imgbbInput.json");

                fetch(hostUrl, {
                    method: 'POST',
                    body: fd
                })
                    .then(response => response.json())
                    .then(data => {
                        saveJson(data, "imgbbOutput.json");
                        resolve(data.data.url);
                    })
                    .catch(error => reject(error));
            });
        } else {
            // URL
            imageUrlPromise = Promise.resolve(req.body.image);
        }

        // Once the image URL is ready, update 'image' (if file), then call Replicate API
        imageUrlPromise.then(async (imageUrl) => {
            var reqBodyUpdated = {
                version: modelCode,
                input: req.body
            };
            reqBodyUpdated.input.image = imageUrl;
            const apiUrl = 'https://api.replicate.com/v1/predictions';
            const apiData = {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${apiToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(reqBodyUpdated) // Forward request body to external API
            };
            saveJson(apiData, "replicatePostInput.json");
            const response = await fetch(apiUrl, apiData);
            let data = await response.json();
            saveJson(data, "replicatePostOutput.json");

            // Start polling until final response received
            while (data.status !== "succeeded" && data.status !== "failed") {
                await sleep(3000); // wait 3 s
                const apiGetReq = {
                    headers: {
                        'Authorization': `Token ${apiToken}`
                    }
                };
                saveJson(apiGetReq, "replicateGetInput.json");
                const response = await fetch("https://api.replicate.com/v1/predictions/" + data.id, apiGetReq);
                data = await response.json();
                saveJson(data, "replicateGetOutput.json");
                if (response.status !== 200) {
                    console.error(data.detail);
                }
            }
            res.json(data);
            console.log('POST request completed');
        }).catch(error => {
            console.error('Error fetching image data:', error);
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});