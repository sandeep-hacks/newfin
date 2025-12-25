import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body;

    if (!message || message.trim() === "") {
      return res.status(400).json({ error: "Message is required" });
    }

    // Get the Gemini model
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Smart prompt that first classifies then responds appropriately
    const prompt = `
    Analyze the following financial message and respond appropriately:
    
    MESSAGE TO ANALYZE: "${message}"
    
    STEP 1: CLASSIFICATION
    First, classify this message into ONE of these categories:
    - "SCAM" - If it shows clear scam indicators (urgent requests for money, fake prizes, phishing links, unrealistic offers)
    - "SUSPICIOUS" - If it has some warning signs but not clearly a scam
    - "NORMAL" - If it appears to be legitimate (bank notifications, balance updates, routine inquiries, statements)
    
    STEP 2: RESPONSE FORMAT
    Based on your classification, use EXACTLY ONE of these formats:
    
    === FOR SCAM/SUSPICIOUS MESSAGES ===
    TYPE: SCAM_ANALYSIS
    VERDICT: [HIGH_RISK, MEDIUM_RISK, or LOW_RISK]
    EXPLANATION: [Explain specific scam indicators found. Point out red flags clearly. Mention if it's phishing, fake offer, etc.]
    SAFETY_TIPS:
    - [Tip 1: Specific action to take]
    - [Tip 2: Specific action to take]
    - [Tip 3: Specific action to take]
    - [Tip 4: Specific action to take]
    
    === FOR NORMAL MESSAGES ===
    TYPE: NORMAL_ANALYSIS
    VERDICT: SAFE
    EXPLANATION: [Explain what this legitimate message means. Clarify if it's a routine notification, balance update, or inquiry.]
    HELPFUL_INFO:
    - [Fact 1: Useful information about this type of message]
    - [Fact 2: Useful information about this type of message]
    - [Fact 3: Useful information about this type of message]
    
    IMPORTANT: 
    1. Use only ONE of the above formats based on your classification.
    2. Keep responses concise but informative.
    3. For Indian students specifically.
    4. Use bullet points (with - ) for lists.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log("Gemini Raw Response:", text);

    // Parse the response
    const lines = text.split('\n');
    let type = "";
    let verdict = "";
    let explanation = "";
    let tips = [];
    let section = "";

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine.startsWith('TYPE:')) {
        type = trimmedLine.replace('TYPE:', '').trim();
      } else if (trimmedLine.startsWith('VERDICT:')) {
        verdict = trimmedLine.replace('VERDICT:', '').trim();
      } else if (trimmedLine.startsWith('EXPLANATION:')) {
        explanation = trimmedLine.replace('EXPLANATION:', '').trim();
        section = "explanation";
      } else if (trimmedLine.startsWith('SAFETY_TIPS:') || trimmedLine.startsWith('HELPFUL_INFO:')) {
        section = "tips";
      } else if (section === "explanation" && trimmedLine && !trimmedLine.startsWith('TYPE:') && !trimmedLine.startsWith('VERDICT:')) {
        explanation += ' ' + trimmedLine;
      } else if (section === "tips" && trimmedLine.startsWith('-')) {
        tips.push(trimmedLine.substring(1).trim());
      }
    }

    // Clean up
    explanation = explanation.trim();
    
    // If no tips were parsed but we have type, create appropriate ones
    if (tips.length === 0) {
      if (type === "NORMAL_ANALYSIS") {
        tips = [
          "This appears to be a legitimate message",
          "Always verify important communications through official apps",
          "Keep your banking app updated for security",
          "Monitor your account regularly for any unauthorized activity"
        ];
      } else {
        tips = [
          "Do not click any links in this message",
          "Never share OTP, PIN, or password with anyone",
          "Verify through official channels before taking any action",
          "Report suspicious messages to your bank immediately"
        ];
      }
    }

    // Determine badge class and response format
    let badgeClass = "safe";
    let verdictText = "This message appears to be legitimate";
    let responseType = "normal";
    let tipsTitle = "Helpful Information";

    if (type === "SCAM_ANALYSIS") {
      responseType = "scam";
      tipsTitle = "Safety Tips";
      
      if (verdict === "HIGH_RISK") {
        badgeClass = "danger";
        verdictText = "⚠️ DANGER! High Risk Scam Detected";
      } else if (verdict === "MEDIUM_RISK") {
        badgeClass = "warning";
        verdictText = "⚠️ Suspicious Message - Proceed with Caution";
      } else {
        badgeClass = "caution";
        verdictText = "⚠️ Potential Risk - Be Cautious";
      }
    } else if (type === "NORMAL_ANALYSIS") {
      responseType = "normal";
      badgeClass = "safe";
      verdictText = "✅ This appears to be a legitimate message";
      tipsTitle = "Helpful Information";
    }

    return res.status(200).json({
      responseType,
      verdict: verdict || "Unknown",
      verdictText,
      badgeClass,
      explanation,
      tips,
      tipsTitle
    });

  } catch (error) {
    console.error("Gemini API Error:", error);
    
    // Fallback analysis
    const lowerMessage = req.body.message.toLowerCase();
    let responseType = "normal";
    let verdict = "Possibly Safe";
    let verdictText = "This message appears to be safe";
    let badgeClass = "safe";
    let explanation = "Unable to connect to AI analysis. Please verify this message through official channels.";
    let tips = [
      "Check with official sources before taking any action",
      "Look for spelling and grammar errors",
      "Verify sender identity",
      "Never share personal information"
    ];
    let tipsTitle = "General Advice";

    // Simple keyword detection for fallback
    const scamKeywords = ['urgent', 'click here', 'verify now', 'suspended', 'won', 'prize', 'free money', 'lottery'];
    const scamCount = scamKeywords.filter(keyword => lowerMessage.includes(keyword)).length;
    
    if (scamCount >= 3) {
      responseType = "scam";
      verdict = "Suspicious";
      verdictText = "⚠️ Multiple scam indicators detected";
      badgeClass = "warning";
      explanation = "This message contains several suspicious keywords. It may be a phishing attempt or scam.";
      tips = [
        "Do not click any links",
        "Do not share personal information",
        "Verify through official channels",
        "Report to authorities if needed"
      ];
      tipsTitle = "Safety Tips";
    }

    return res.status(200).json({
      responseType,
      verdict,
      verdictText,
      badgeClass,
      explanation,
      tips,
      tipsTitle,
      fallback: true
    });
  }
}
