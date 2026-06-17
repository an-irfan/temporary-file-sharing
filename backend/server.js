require("dotenv").config();

const express = require("express");
const multer = require("multer");
const QRCode = require("qrcode");
const cron = require("node-cron");
const { v4: uuidv4 } = require("uuid");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const https = require("https");

const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

const app = express();



// ENV VARIABLES
const PORT = process.env.PORT || 3000;

const FRONTEND_URL =
    process.env.FRONTEND_URL ||
    process.env.BASE_URL ||
    "http://localhost:5173";
    console.log("FRONTEND_URL =", FRONTEND_URL);
    console.log("BASE_URL =", process.env.BASE_URL);

const BACKEND_URL =
    process.env.BACKEND_URL ||
    `http://localhost:${PORT}`;

const EXPIRY_MINUTES = parseInt(
    process.env.EXPIRY_MINUTES
);

const CRON_SCHEDULE =
    process.env.CRON_SCHEDULE;




// MIDDLEWARE
app.set("trust proxy", true);

app.use(express.json());

app.use(cors());



// MONGODB CONNECTION
mongoose.connect(process.env.MONGO_URI)

.then(() => {

    console.log("MongoDB Atlas Connected");

})

.catch((err) => {

    console.log(err);

});




// DATABASE SCHEMA
const fileSchema = new mongoose.Schema({

    fileId: String,

    fileTitle: String,

    originalName: String,

    mimeType: String,

    originalSize: Number,

    e2ee: {

        v: Number,

        kdf: String,

        hash: String,

        iterations: Number,

        saltB64u: String,

        cipher: String,

        ivB64u: String,

        aadB64u: String

    },

    url: String,

    public_id: String,

    expiresAt: Date,

    createdAt: {

        type: Date,

        default: Date.now

    }

});



// Auto delete expired MongoDB entries

fileSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
);

const File = mongoose.model(
    "File",
    fileSchema
);



// CLOUDINARY CONFIG
cloudinary.config({

    cloud_name: process.env.CLOUD_NAME,

    api_key: process.env.API_KEY,

    api_secret: process.env.API_SECRET

});



// MULTER STORAGE
const storage = new CloudinaryStorage({

    cloudinary: cloudinary,

    params: {

        folder: "temp-share",

        resource_type: "raw"

    }

});

const upload = multer({ storage });



// HOME ROUTE
app.get("/", (req, res) => {

    res.send(
        "Temporary File Sharing System Running"
    );

});


// FILE UPLOAD ROUTE
app.post(

    "/upload",

    upload.single("file"),

    async (req, res) => {

        try {

            const title = req.body.title;
            const e2eeRaw = req.body.e2ee;

            if (!title) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Title required"

                });

            }

            if (!req.file) {

                return res.status(400).json({

                    success: false,

                    message: "File required"

                });

            }

            if (!e2eeRaw) {

                return res.status(400).json({

                    success: false,

                    message: "E2EE metadata required"

                });

            }

            let e2ee;

            try {

                e2ee = JSON.parse(e2eeRaw);

            } catch {

                return res.status(400).json({

                    success: false,

                    message: "Invalid E2EE metadata"

                });

            }

            if (
                !e2ee ||
                e2ee.v !== 1 ||
                !e2ee.saltB64u ||
                !e2ee.ivB64u ||
                !e2ee.aadB64u ||
                !e2ee.iterations ||
                !e2ee.originalName ||
                !e2ee.mimeType ||
                typeof e2ee.originalSize !== "number"
            ) {

                return res.status(400).json({

                    success: false,

                    message: "Incomplete E2EE metadata"

                });

            }

            const fileId = uuidv4();

            const expiryTime = new Date(

                Date.now() +

                EXPIRY_MINUTES * 60 * 1000

            );

            // QR opens frontend access page
            const fileUrl =

                `${FRONTEND_URL}/access/${fileId}?title=${encodeURIComponent(title)}`;

            // Save file
            await File.create({

                fileId: fileId,

                fileTitle: title,

                originalName:
                    e2ee.originalName,

                mimeType:
                    e2ee.mimeType,

                originalSize:
                    e2ee.originalSize,

                e2ee: {

                    v: e2ee.v,

                    kdf: e2ee.kdf,

                    hash: e2ee.hash,

                    iterations:
                        e2ee.iterations,

                    saltB64u:
                        e2ee.saltB64u,

                    cipher:
                        e2ee.cipher,

                    ivB64u:
                        e2ee.ivB64u,

                    aadB64u:
                        e2ee.aadB64u

                },

                url: req.file.path,

                public_id: req.file.filename,

                expiresAt: expiryTime

            });

            // Generate QR
            const qrCode =

                await QRCode.toDataURL(fileUrl);

            res.json({

                success: true,

                message:
                    "File Uploaded Successfully",

                fileTitle: title,

                downloadLink: fileUrl,

                qrCode: qrCode,

                expiresInMinutes:
                    EXPIRY_MINUTES

            });

        } catch (err) {

            res.status(500).json({

                success: false,

                error: err.message

            });

        }

    }

);



// METADATA ROUTE (NO PASSWORD)
app.get("/metadata/:id", async (req, res) => {

    try {

        const file = await File.findOne({

            fileId: req.params.id

        });

        // File not found
        if (!file) {

            return res.status(404).json({

                success: false,

                message: "File Not Found"

            });

        }

        // File expired
        if (new Date() > file.expiresAt) {

            return res.status(410).json({

                success: false,

                message: "File Expired"

            });

        }

        // Success
        res.json({

            success: true,

            fileTitle: file.fileTitle,

            originalName:
                file.originalName,

            mimeType: file.mimeType,

            originalSize:
                file.originalSize,

            e2ee: file.e2ee,

            encryptedDownloadURL:
                `${req.protocol}://${req.get("host")}/encrypted/${file.fileId}`

        });

    } catch (err) {

        res.status(500).json({

            success: false,

            error: err.message

        });

    }

});



// SEARCH FILE ROUTE
app.post("/search-file", async (req, res) => {

    try {

        const title =
            (req.body?.title || "").trim();

        if (!title) {

            return res.status(400).json({

                success: false,

                message: "Title required"

            });

        }

        const escapeRegExp = (value) =>
            value.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
            );

        const titleRegex = new RegExp(
            `^${escapeRegExp(title)}$`,
            "i"
        );

        const now = new Date();

        const file = await File.findOne({

            fileTitle: titleRegex,

            expiresAt: { $gt: now }

        }).sort({ createdAt: -1 });

        // File not found
        if (!file) {

            const maybeExpired =
                await File.findOne({

                    fileTitle: titleRegex

                }).sort({ createdAt: -1 });

            if (maybeExpired) {

                return res.status(410).json({

                    success: false,

                    message: "File Expired"

                });

            }

            return res.status(404).json({

                success: false,

                message: "File Not Found"

            });

        }

        // Success
        res.json({

            success: true,

            fileId: file.fileId,

            fileTitle: file.fileTitle,

            originalName:
                file.originalName,

            mimeType: file.mimeType,

            originalSize:
                file.originalSize,

            e2ee: file.e2ee,

            encryptedDownloadURL:
                `${req.protocol}://${req.get("host")}/encrypted/${file.fileId}`

        });

    } catch (err) {

        res.status(500).json({

            success: false,

            error: err.message

        });

    }

});



// DOWNLOAD ROUTE
const proxyToClient = (sourceUrl, res, options) => {

    try {

        const url = new URL(sourceUrl);

        const client =
            url.protocol === "https:" ? https : http;

        const request = client.get(url, (upstream) => {

            if (
                upstream.statusCode >= 300 &&
                upstream.statusCode < 400 &&
                upstream.headers.location
            ) {

                const redirected = new URL(
                    upstream.headers.location,
                    url
                );

                proxyToClient(
                    redirected.toString(),
                    res,
                    options
                );

                return;

            }

            if (
                upstream.statusCode &&
                upstream.statusCode >= 400
            ) {

                res.status(upstream.statusCode).send(
                    "Download Failed"
                );

                upstream.resume();
                return;

            }

            res.setHeader(
                "Content-Type",
                "application/octet-stream"
            );

            if (options?.filename) {

                res.setHeader(
                    "Content-Disposition",
                    `attachment; filename="${options.filename}"`
                );

            }

            upstream.pipe(res);

        });

        request.on("error", () => {
            res.status(500).send("Download Failed");
        });

    } catch {

        res.status(500).send("Download Failed");

    }

};

app.get("/download/:id", async (req, res) => {

    try {

        const file = await File.findOne({

            fileId: req.params.id

        });

        // File not found
        if (!file) {

            return res.status(404).send(
                "File Not Found"
            );

        }

        // File expired
        if (new Date() > file.expiresAt) {

            return res.status(410).send(
                "File Expired"
            );

        }

        proxyToClient(
            file.url,
            res,
            { filename: `${file.fileId}.bin` }
        );

    } catch (err) {

        res.status(500).send(err.message);

    }

});

app.get("/encrypted/:id", async (req, res) => {

    try {

        const file = await File.findOne({

            fileId: req.params.id

        });

        if (!file) {

            return res.status(404).send(
                "File Not Found"
            );

        }

        if (new Date() > file.expiresAt) {

            return res.status(410).send(
                "File Expired"
            );

        }

        proxyToClient(
            file.url,
            res,
            { filename: `${file.fileId}.bin` }
        );

    } catch (err) {

        res.status(500).send(err.message);

    }

});


// AUTO DELETE CRON JOB
cron.schedule(CRON_SCHEDULE, async () => {

    console.log(
        "Checking expired files..."
    );

    const now = new Date();

    const expiredFiles = await File.find({

        expiresAt: { $lt: now }

    });

    for (let file of expiredFiles) {

        try {

            // Delete from Cloudinary
            await cloudinary.uploader.destroy(

                file.public_id,

                {
                    resource_type: "raw"
                }

            );

            // Delete from MongoDB
            await File.deleteOne({

                _id: file._id

            });

            console.log(
                "Deleted:",
                file.fileId
            );

        } catch (err) {

            console.log(
                "Deletion Error:",
                err.message
            );

        }

    }

});



// START SERVER
app.listen(PORT, () => {

    console.log(

        `Server Running On ${BACKEND_URL}`

    );

});
