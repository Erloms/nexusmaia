import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Mic, MicOff, Image as ImageIcon, Shuffle } from "lucide-react";
import { useToast } from "@/hooks/use-toast"; // Updated import

interface Message {
  text: string;
  sender: "user" | "ai";
  type?: "text" | "image" | "audio";
  imageUrl?: string;
  audioUrl?: string;
}

interface ChatMainProps {
  messages: Message[];
  input: string;
  setInput: (val: string) => void;
  isTyping: boolean;
  isListening: boolean;
  onSend: () => void;
  onStartListening: () => void;
  onSynthesizeVoice?: (text: string) => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
}

// Helper function to construct Pollinations.ai image URL based on detailed prompt rules
const constructPollinationsImageUrl = (
  basePrompt: string,
  options?: {
    sceneDetailed?: string;
    adjective?: string;
    charactersDetailed?: string;
    visualStyle?: string;
    genre?: string;
    artistReference?: string;
    model?: string;
    width?: number;
    height?: number;
    seed?: string; // Allow specific seed
  }
) => {
  let finalPrompt = basePrompt;

  // Enhance basePrompt if it's too short (aim for ~50 words)
  if (finalPrompt.split(' ').length < 10) { 
    finalPrompt += ", highly detailed, cinematic lighting, vibrant colors, professional photography, 8k";
  }

  const parts = [
    options?.sceneDetailed,
    options?.adjective,
    options?.charactersDetailed,
    options?.visualStyle,
    options?.genre,
    options?.artistReference,
  ].filter(Boolean); // Remove undefined/null parts

  if (parts.length > 0) {
    finalPrompt = `${finalPrompt}, ${parts.join(', ')}`;
  }

  const encodedPrompt = encodeURIComponent(finalPrompt);
  const width = options?.width || 1024;
  const height = options?.height || 768;
  const model = options?.model || 'flux'; // Default to 'flux'
  const seed = options?.seed || Math.floor(Math.random() * 1000000).toString(); // Use provided seed or generate random

  return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&model=${model}&nologo=true`;
};


const ChatMain: React.FC<ChatMainProps> = ({
  messages,
  input,
  setInput,
  isTyping,
  isListening,
  onSend,
  onStartListening,
  onSynthesizeVoice,
  selectedModel,
  onModelChange
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const { toast } = useToast(); // Initialize useToast

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // AI模型列表（基于Pollinations.ai）
  const AI_MODELS = [
    { id: "openai", name: "OpenAI GPT-4o-mini", group: "OpenAI" },
    { id: "openai-large", name: "OpenAI GPT-4o", group: "OpenAI" },
    { id: "openai-reasoning", name: "OpenAI o1-mini", group: "OpenAI" },
    { id: "llama", name: "Llama 3.3 70B", group: "Meta" },
    { id: "llamalight", name: "Llama 3.1 8B Instruct", group: "Meta" },
    { id: "mistral", name: "Mistral Nemo", group: "Mistral" },
    { id: "deepseek", name: "DeepSeek-V3", group: "DeepSeek" },
    { id: "deepseek-r1", name: "DeepSeek-R1 Distill Qwen 32B", group: "DeepSeek" },
    { id: "deepseek-reasoner", name: "DeepSeek R1 - Full", group: "DeepSeek" },
    { id: "deepseek-r1-llama", name: "DeepSeek R1 - Llama 70B", group: "DeepSeek" },
    { id: "claude", name: "Claude 3.5 Haiku", group: "Anthropic" },
    { id: "gemini", name: "Gemini 2.0 Flash", group: "Google" },
    { id: "gemini-thinking", name: "Gemini 2.0 Flash Thinking", group: "Google" },
    { id: "phi", name: "Phi-4 Multimodal Instruct", group: "Microsoft" },
    { id: "qwen-coder", name: "Qwen 2.5 Coder 32B", group: "Qwen" }
  ];

  // 随机切换模型
  const switchRandomModel = () => {
    const randomModel = AI_MODELS[Math.floor(Math.random() * AI_MODELS.length)];
    onModelChange(randomModel.id);
    toast({
      title: "模型已切换",
      description: `已切换到：${randomModel.name}`,
    });
  };

  // 生成配图
  const generateImage = async (prompt: string) => {
    setIsGeneratingImage(true);
    
    try {
      // Use the helper function to construct the image URL
      const imageUrl = constructPollinationsImageUrl(prompt, {
        width: 1024, // Default width for chat images
        height: 768, // Default height for chat images
        model: 'flux', // Default model for chat images
      });
      
      // Add image message
      const imageMessage: Message = {
        text: "为您生成的配图：",
        sender: "ai",
        type: "image",
        imageUrl: imageUrl
      };
      
      // This message needs to be added to the parent component's messages state
      // For now, we'll just return it, assuming the parent will handle adding it.
      return imageMessage;
    } catch (error) {
      console.error('生成图像失败:', error);
      toast({
        title: "生成失败",
        description: "图像生成过程中出现错误，请稍后重试",
        variant: "destructive"
      });
    } finally {
      setIsGeneratingImage(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col w-full min-h-0">
      {/* 顶部标题+装饰 */}
      <div className="py-12 mb-6">
        <h1 className="text-3xl md:text-4xl font-black bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent text-center drop-shadow-lg tracking-tight">
          智能创作工作台
        </h1>
        <p className="text-center text-gray-400 mt-3 text-lg">集成15+顶级AI模型，支持对话、绘画、创作一体化体验</p>
        
        {/* 模型选择器 */}
        <div className="flex justify-center mt-4 gap-3">
          <select 
            value={selectedModel} 
            onChange={(e) => onModelChange(e.target.value)}
            className="bg-[#1a2740] text-white border border-[#203042]/60 rounded-lg px-3 py-2 text-sm"
          >
            {AI_MODELS.reduce((groups: any, model) => {
              if (!groups[model.group]) {
                groups[model.group] = [];
              }
              groups[model.group].push(model);
              return groups;
            }, {}).map ? 
              Object.entries(AI_MODELS.reduce((groups: any, model) => {
                if (!groups[model.group]) {
                  groups[model.group] = [];
                }
                groups[model.group].push(model);
                return groups;
              }, {})).map(([group, models]: any) => (
                <optgroup key={group} label={group}>
                  {models.map((model: any) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </optgroup>
              ))
            : 
              AI_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))
            }
          </select>
          <Button
            onClick={switchRandomModel}
            variant="outline"
            size="sm"
            className="border-cyan-400 text-cyan-400 hover:bg-cyan-400 hover:text-white"
          >
            <Shuffle className="h-4 w-4 mr-1" />
            随机模型
          </Button>
        </div>
      </div>

      {/* 聊天内容 */}
      <div className="flex-1 overflow-y-auto px-0 md:px-8 max-h-[62vh] min-h-[320px] pb-6">
        {messages.length === 0 ? (
          <div className="flex flex-col justify-center items-center h-full text-gray-400 opacity-70 text-lg">
            试试左侧建议问题或者自由提问吧～
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${
                  msg.sender === "user"
                    ? "justify-end"
                    : "justify-start"
                }`}
              >
                 <div
                   className={`max-w-[80%] rounded-2xl p-4 shadow relative ${
                     msg.sender === "user"
                       ? "bg-gradient-to-br from-[#22498e] to-[#22cbed] text-white"
                       : "bg-[#1a2740] text-gray-100 border border-[#203042]/60"
                   }`}
                 >
                   {msg.type === "image" && msg.imageUrl ? (
                     <img
                       src={msg.imageUrl}
                       alt="AI生成图像"
                       className="rounded mb-2 max-w-full border border-[#203042]/30"
                     />
                   ) : null}
                   <span className="whitespace-pre-line text-base leading-relaxed">{msg.text}</span>
                   
                   {/* AI消息添加语音播放按钮 */}
                   {msg.sender === "ai" && onSynthesizeVoice && (
                     <Button
                       size="sm"
                       variant="ghost"
                       className="absolute top-2 right-2 p-1 h-6 w-6 text-cyan-400 hover:bg-cyan-800/20"
                       onClick={() => onSynthesizeVoice(msg.text)}
                     >
                       <Mic className="h-3 w-3" />
                     </Button>
                   )}
                 </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="p-4 rounded-2xl bg-[#1a2740]/80 text-cyan-300">
                  正在思考...
                </div>
              </div>
            )}
            <div ref={messagesEndRef}></div>
          </div>
        )}
      </div>

      {/* 输入区（操作条悬浮底部） */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center items-end w-full pointer-events-none">
        <div className="pointer-events-auto w-full max-w-3xl mb-8 px-4 ml-96">
          <div className="px-3 py-3 bg-gradient-to-b from-[#151b2a] to-[#213548] rounded-2xl flex gap-3 shadow-2xl border border-[#243655]/60">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="输入你的问题或需求，按回车发送"
              className="bg-transparent border-none text-base flex-1 resize-none h-12"
              rows={2}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
            />
            <Button
              onClick={() => generateImage(input)}
              disabled={!input.trim() || isGeneratingImage}
              size="icon"
              variant="ghost"
              className="bg-transparent text-purple-400 hover:bg-purple-800/20 mr-1"
              title="生成配图"
            >
              {isGeneratingImage ? (
                <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <ImageIcon className="h-4 w-4" />
              )}
            </Button>
            <Button
              onClick={onStartListening}
              disabled={isListening}
              size="icon"
              variant="ghost"
              className="bg-transparent text-cyan-400 hover:bg-cyan-800/20 mr-1"
            >
              {isListening ? <MicOff /> : <Mic />}
            </Button>
            <Button
              onClick={onSend}
              disabled={!input.trim() || isTyping}
              className="bg-gradient-to-r from-cyan-400 to-blue-600 text-white px-5 rounded-xl text-base shadow-lg font-bold"
            >
              <Send className="mr-1" /> 发送
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatMain;