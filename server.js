const { Telegraf } = require('telegraf');
const { message } = require('telegraf/filters');
const axios = require('axios');
const pdf = require('pdf-parse');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.telegram.setWebhook(`https:tele-bot-pdf-summarizer.vercel.app/bot${process.env.BOT_TOKEN}`);

function splitIntoChunks(text, maxLength = 3000) {
  const chunks = [];
  let currentChunk = '';
  let currentLength = 0;

  const lines = text.split('\n');

  for (const line of lines) {
    if (currentLength + line.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
        currentLength = 0;
      }
    }
    currentChunk += (currentChunk ? '\n' : '') + line;
    currentLength += line.length + 1;
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

function formatText(text) {
  return text
    .split('\n')
    .map(line => {
      // Escape MarkdownV2 special characters
      line = line.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1'); // Escape special chars

      line = line.trim();
      if (line.startsWith('*')) {
        return `${line.replace(/^\*|\*$/g, '')}:`;
      }
      if (/^\d+\./.test(line)) {
        return line.replace(/^\d+\.\s*\*?(.*?)\*?:/, '$1:');
      }
      return line;
    })
    .join('\n');
}

bot.on(message('document'), async (ctx) => {
  try {
    await ctx.reply('📚 Processing your PDF...');
    
    const fileId = ctx.message.document.file_id;
    const file = await ctx.telegram.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    
    const data = await pdf(buffer);
    const summaryChunks = await summarize(data.text, "provide a detailed summary of the");

    let partNumber = 1;
    const totalParts = summaryChunks.length;

    for (const chunk of summaryChunks) {
      try {
        await ctx.reply(`📝 Summary (Part ${partNumber} of ${totalParts})`);
        const formattedText = formatText(chunk);
        await ctx.replyWithMarkdownV2(formattedText);

        partNumber++;
        if (partNumber <= totalParts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Error sending part ${partNumber}:`, error);
        await ctx.reply(`⚠️ Error sending part ${partNumber}. Please try again.`);
      }
    }
    await ctx.reply('✅ Summary completed!');
    
  } catch (error) {
    console.error('Error processing PDF:', error);
    await ctx.reply('❌ Sorry, there was an error processing the PDF. Please try again.');
  }
});

async function summarize(text, prompt) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEM_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const customPrompt = `Please ${prompt} the following content in a clear, well-structured format. For each topic, provide a brief but comprehensive overview:\n${text}`;
    const result = await model.generateContent(customPrompt);
    const summary = result.response.text();

    return splitIntoChunks(summary);
  } catch (error) {
    console.error('Error in summarization:', error);
    return ["Sorry, I couldn't generate a summary at this time."];
  }
}
bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));