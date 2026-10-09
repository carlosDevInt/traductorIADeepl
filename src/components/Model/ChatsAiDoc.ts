// // server.ts
// import express from "express";
// import cors from "cors";
// import { generateText } from "ai";
// import { google } from "@ai-sdk/google";
// import dotenv from "dotenv";

// dotenv.config();
// console.log("API Key starts with:", process.env.GOOGLE_GENERATIVE_AI_API_KEY?.substring(0, 5));

// const app = express();
// app.use(cors());
// app.use(express.json());

// app.post("/chat", async (req, res) => {
//     try {
//         const { prompt, messages } = req.body;

//         let resultText = "";

//         if (Array.isArray(messages) && messages.length > 0) {
//             const formattedMessages = messages.map((m: any) => ({
//                 role: m.rol === "ia" || m.role === "assistant" ? ("assistant" as const) : ("user" as const),
//                 content: m.texto || m.content || "",
//             }));

//             const { text } = await generateText({
//                 model: google("gemini-3.1-flash-lite"),
//                 messages: formattedMessages,
//             });
//             resultText = text;
//         } else {
//             const { text } = await generateText({
//                 model: google("gemini-3.1-flash-lite"), 
//                 prompt,
//             });
//             resultText = text;
//         }

//         res.json({ text: resultText });

//     } catch (error) {
//         console.error(error);

//         res.status(500).json({
//             error: "Error generando respuesta con Gemini",
//             details: error instanceof Error ? error.message : String(error),
//         });
//     }
// });

// app.listen(3001, () => {
//     console.log("Servidor funcionando");
//     console.log("API Key starts with:", process.env.GOOGLE_GENERATIVE_AI_API_KEY?.substring(0, 5));
//     console.log("PORT:", process.env.PORT || 3001);
//     console.log("Gemini chat text modelo funcionando "+ (process.env.GOOGLE_GENERATIVE_AI_API_KEY ? "✅" : "❌"));
// });