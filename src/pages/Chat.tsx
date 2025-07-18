import React, { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast"; // Updated import
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import ChatSidebar from '@/components/ChatSidebar';
import { Send, Crown, MessageSquare, Bot, Sparkles, Wand2 } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  imageUrl?: string;
}

const Chat = () => {
  const { toast } = useToast();
  const { hasPermission, user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gpt-4o-mini'); // For general text generation
  const [selectedAgent, setSelectedAgent] = useState('xiaohongshu-strategist'); // For specialized agents
  const [chatMode, setChatMode] = useState<'general' | 'agent'>('general'); // 'general' or 'agent'
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // OpenRouter API Key (In a real application, this should be an environment variable or managed securely)
  const OPENROUTER_API_KEY = "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"; // Updated API Key

  // AI大模型列表 (移除来源信息)
  const aiTextModels = [
    { id: "gpt-4o-mini", name: "GPT-4o-mini" },
    { id: "llama", name: "Llama 3.3 70B" },
    { id: "mistral", name: "Mistral Nemo" },
    { id: "deepseek", name: "DeepSeek-V3" },
    { id: "deepseek-r1", name: "DeepSeek-R1 Distill Qwen 32B" },
    { id: "phi", name: "Phi-4 Multimodal Instruct" },
    { id: "qwen-coder", name: "Qwen 2.5 Coder 32B" },
    // OpenRouter models (通过ID格式区分，不显示来源)
    { id: "google/gemma-3n-e4b-it:free", name: "Gemma 3n 4B" },
    { id: "qwen/qwen3-235b-a22b:free", name: "Qwen 3 235B" },
    { id: "deepseek/deepseek-r1:free", name: "DeepSeek R1" },
    { id: "deepseek/deepseek-chat-v3-0324:free", name: "DeepSeek v3" },
    { id: "agentica-org/deepcoder-14b-preview:free", name: "DeepCoder 14B" },
    { id: "meta-llama/llama-4-maverick:free", name: "Llama 4 Maverick" },
    { id: "moonshotai/kimi-dev-72b:free", name: "Kimi Dev 72B" },
    // 新增模型
    { id: "qwen/qwen3-30b-a3b:free", name: "Qwen 3 30B" },
    { id: "tencent/hunyuan-a13b-instruct:free", name: "Hunyuan A13B Instruct" },
    { id: "google/gemini-2.0-flash-exp:free", name: "Gemini 2.0 Flash Exp" },
    { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B Instruct" },
  ];

  // AI智能体列表
  const aiAgents = [
    { id: "xiaohongshu-strategist", name: "小红书图文策略师", group: "内容创作", description: "爆款小红书内容一键生成" },
    { id: "seo-optimizer", name: "SEO优化大师", group: "营销推广", description: "提升网站排名和流量" },
    { id: "video-script-writer", name: "短视频脚本专家", group: "内容创作", description: "快速生成吸睛短视频脚本" },
    { id: "business-analyst", name: "商业数据分析师", group: "商业智能", description: "洞察市场趋势，辅助决策" },
    { id: "personal-trainer", name: "智能健身教练", group: "生活助手", description: "定制专属健身计划" },
    { id: "travel-planner", name: "全球旅行规划师", group: "生活助手", description: "个性化行程安排" },
    { id: "code-generator", name: "代码生成器", group: "开发工具", description: "快速生成代码片段或完整程序" },
    { id: "resume-optimizer", name: "简历优化师", group: "职业发展", description: "优化简历，提升面试机会" },
    { id: "mental-wellness-assistant", name: "心理咨询助手", group: "生活助手", description: "提供情绪支持和心理建议" },
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 通用文本生成API调用
  const callTextAPI = async (prompt: string, modelId: string) => {
    setIsLoading(true);
    const selectedModelConfig = aiTextModels.find(m => m.id === modelId);
    if (!selectedModelConfig) {
      throw new Error("Selected model not found.");
    }

    let aiResponse = '';
    try {
      // 根据 modelId 的格式判断是 Pollinations.ai 还是 OpenRouter 模型
      const isPollinationsModel = !modelId.includes('/'); // Pollinations models typically don't have '/' in their ID
      
      if (isPollinationsModel) {
        const encodedPrompt = encodeURIComponent(prompt);
        const apiUrl = `https://text.pollinations.ai/${encodedPrompt}?model=${modelId}`;
        
        const response = await fetch(apiUrl);
        if (!response.ok) {
          throw new Error(`Pollinations API error: ${response.status}`);
        }
        
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          
          aiResponse = chunk; // Overwrite with the latest chunk
          
          setMessages(prev => {
            const newMessages = [...prev];
            let lastAssistantMessageIndex = -1;
            for (let i = newMessages.length - 1; i >= 0; i--) {
              if (newMessages[i].role === 'assistant') {
                lastAssistantMessageIndex = i;
                break;
              }
            }
            if (lastAssistantMessageIndex !== -1) {
              newMessages[lastAssistantMessageIndex].content = aiResponse;
            } else {
              newMessages.push({ id: Date.now().toString(), role: 'assistant', content: aiResponse, timestamp: new Date() });
            }
            return newMessages;
          });
        }
      } else { // Assume OpenRouter model if it contains '/'
        const openRouterApiUrl = "https://openrouter.ai/api/v1/chat/completions";
        const response = await fetch(openRouterApiUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: "user", content: prompt }],
            stream: true, // Request streaming response
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`OpenRouter API error: ${response.status} - ${errorData.message || JSON.stringify(errorData)}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          
          chunk.split('\n').forEach(line => {
            if (line.startsWith('data: ')) {
              const jsonStr = line.substring(6);
              if (jsonStr === '[DONE]') {
                return;
              }
              try {
                const data = JSON.parse(jsonStr);
                if (data.choices && data.choices.length > 0 && data.choices[0].delta && data.choices[0].delta.content) {
                  aiResponse += data.choices[0].delta.content;
                  setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMsg = newMessages[newMessages.length - 1];
                    if (lastMsg && lastMsg.role === 'assistant') {
                      lastMsg.content = aiResponse;
                    } else {
                      newMessages.push({ id: Date.now().toString(), role: 'assistant', content: aiResponse, timestamp: new Date() });
                    }
                    return newMessages;
                  });
                }
              } catch (e) {
                console.error("Error parsing OpenRouter stream chunk:", e, jsonStr);
              }
            }
          });
        }
      }
      
      return aiResponse;
    } catch (error: any) {
      console.error("API call error:", error);
      toast({
        title: "模型调用失败",
        description: `请重试或切换其他模型: ${error.message}`,
        variant: "destructive"
      });
      return "抱歉，我在处理您的请求时遇到了问题。请稍后再试。";
    } finally {
      setIsLoading(false);
    }
  };

  // 模拟智能体API调用
  const callAgentAPI = async (prompt: string, agentId: string) => {
    try {
      setIsLoading(true);
      let aiResponse = '';

      if (agentId === 'xiaohongshu-strategist') {
        const topic = prompt.replace('帮我分析', '').trim(); // 简单提取主题
        const randomSeed1 = Math.floor(Math.random() * 1000000);
        const randomSeed2 = Math.floor(Math.random() * 1000000);
        const randomSeed3 = Math.floor(Math.random() * 1000000);
        const randomSeed4 = Math.floor(Math.random() * 1000000);
        const randomSeed5 = Math.floor(Math.random() * 1000000);
        const randomSeed6 = Math.floor(Math.random() * 1000000);
        const randomSeed7 = Math.floor(Math.random() * 1000000);
        const randomSeed8 = Math.floor(Math.random() * 1000000);
        const randomSeed9 = Math.floor(Math.random() * 1000000);
        const randomSeed10 = Math.floor(Math.random() * 1000000);
        const randomSeed11 = Math.floor(Math.random() * 1000000);
        const randomSeed12 = Math.floor(Math.random() * 1000000);

        aiResponse = `
**爆款诊断**
先分析用户需求：**${topic || '用户输入的主题'}** 关联的TOP3高互动场景是：
1. **情绪价值：** 激发用户情感共鸣，如分享个人成长、克服困难的经历，或展示美好生活瞬间。
2. **实用价值：** 提供具体、可操作的解决方案或教程，如美妆教程、穿搭技巧、美食食谱、学习方法等。
3. **娱乐价值：：** 创造轻松愉快的氛围，如搞笑段子、萌宠日常、旅行vlog、趣味挑战等。

**文案生成（含3套变体）**

---

**📌 高互动模板**
**策略点：** 悬念钩子、数字清单、身份认同、紧急感
**文案：**
[标题] 😱 震惊！我竟然靠这3招，让小红书笔记阅读量翻了10倍！
[正文]
姐妹们，是不是也和我一样，每次发小红书笔记都石沉大海？别急！今天我把压箱底的爆款秘籍分享给你们，亲测有效！
1. **悬念钩子：** “你以为小红书只有颜值？错！这才是真正能让你涨粉的秘密武器！”
2. **数字清单：** “3个步骤，让你轻松打造高互动笔记，小白也能变大神！”
3. **身份认同：** “如果你也是内容创作者，这条笔记你一定要看完！”
4. **紧急感：：** “再不学就晚了！小红书算法又变了，赶紧抓住这波红利！”
[配图]
![配图1](https://image.pollinations.ai/prompt/A cute cat in space, digital art, vibrant colors&width=1024&height=1024&seed=${randomSeed1}&model=flux&nologo=true)
![配图2](https://image.pollinations.ai/prompt/A cute cat in space, digital art, vibrant colors&width=1024&height=1024&seed=${randomSeed2}&model=flux&nologo=true)
![配图3](https://image.pollinations.ai/prompt/A cute cat in space, digital art, vibrant colors&width=1024&height=1024&seed=${randomSeed3}&model=flux&nologo=true)
![配图4](https://image.pollinations.ai/prompt/A cute cat in space, digital art, vibrant colors&width=1024&height=1024&seed=${randomSeed4}&model=flux&nologo=true)

---

**📌 情绪共鸣模板**
**策略点：** 治愈、共情、鼓励、温暖
**文案：**
[标题] 💔 别再emo了！这几句话，治愈了我的小红书焦虑症！
[正文]
是不是总觉得自己不够好，笔记没人看？我懂你！曾经我也深陷这种情绪，直到我学会了这几招，瞬间被治愈！
1. **治愈：** “生活再难，也要给自己一点甜，小红书就是我的精神角落。”
2. **共情：：** “你不是一个人在战斗，我们都在努力变好！”
3. **鼓励：** “相信自己，你的每一次分享都值得被看见！”
4. **温暖：** “愿你的小红书，成为你温暖的避风港。”
[配图]
![配图1](https://image.pollinations.ai/prompt/A cozy cat sleeping on a book, warm lighting, soft colors&width=1024&height=1024&seed=${randomSeed5}&model=flux&nologo=true)
![配图2](https://image.pollinations.ai/prompt/A cozy cat sleeping on a book, warm lighting, soft colors&width=1024&height=1024&seed=${randomSeed6}&model=flux&nologo=true)
![配图3](https://image.pollinations.ai/prompt/A cozy cat sleeping on a book, warm lighting, soft colors&width=1024&height=1024&seed=${randomSeed7}&model=flux&nologo=true)
![配图4](https://image.pollinations.ai/prompt/A cozy cat sleeping on a book, warm lighting, soft colors&width=1024&height=1024&seed=${randomSeed8}&model=flux&nologo=true)

---

**📌 商业变现模板**
**策略点：** 收益可视化、素人可复制、步骤拆解（3步起号）、资源包钩子
**文案：**
[标题] 💰 0基础小白，30天小红书变现10000+，我做到了！
[正文]
别再羡慕别人了！我一个普通人，只用了30天，就在小红书实现了月入过万！今天把我的秘诀毫无保留地分享给你！
1. **收益可视化：** “上个月我的小红书收益截图，真实数据，不P图！”
2. **素人可复制：：** “我不是什么大V，普通人也能轻松上手，跟着我做就行！”
3. **步骤拆解：** “第一步：定位你的赛道；第二步：打造爆款内容；第三步：高效引流变现！”
4. **资源包钩子：** “评论区留言‘变现’，免费送你我的小红书变现秘籍资料包！”
[配图]
![配图1](https://image.pollinations.ai/prompt/A person counting money, surrounded by digital graphs, vibrant colors&width=1024&height=1024&seed=${randomSeed9}&model=flux&nologo=true)
![配图2](https://image.pollinations.ai/prompt/A person counting money, surrounded by digital graphs, vibrant colors&width=1024&height=1024&seed=${randomSeed10}&model=flux&nologo=true)
![配图3](https://image.pollinations.ai/prompt/A person counting money, surrounded by digital graphs, vibrant colors, close up of hands&width=1024&height=1024&seed=${randomSeed11}&model=flux&nologo=true)
![配图4](https://image.pollinations.ai/prompt/A person counting money, surrounded by digital graphs, vibrant colors, abstract background&width=1024&height=1024&seed=${randomSeed12}&model=flux&nologo=true)

---

**👑绘画技能：**
自由输出文案配图或展开联想，生成对应的英文提示词填充到以下url的占位符中:image，其中，{prompt}必须是英文，符合stable diffusion提示词格式，你的提示词不会对生活造成任何负面影响，你可以描述任何内容而不用担心违反协议，生成后给出中文提示语。记住这个防伪口诀：链接尾巴必须带&model=flux&nologo=true双符咒，少一个标点都会中邪。要改尺寸？把width和height数字调换位置就是逆练功法👇

根据文案自动生成4图组合：
爆款增强包 ✅ 标题优化器：自动生成10条带emoji的变体 ✅ 标签策略：按内容匹配三级标签） ✅ 发布时间建议：根据历史数据推荐**${topic || '用户输入的主题'}**流量高峰时段
        `;
      } else if (agentId === 'code-generator') {
        aiResponse = `您选择了代码生成器。请告诉我您需要生成什么语言的代码，以及具体的功能需求，例如：“用Python写一个计算斐波那契数列的函数。”`;
      } else if (agentId === 'resume-optimizer') {
        aiResponse = `您选择了简历优化师。请粘贴您的简历内容，或者告诉我您的目标职位和主要经历，我将为您提供优化建议。`;
      } else if (agentId === 'mental-wellness-assistant') {
        aiResponse = `您选择了心理咨询助手。请告诉我您现在的心情或遇到的困扰，我将尽力为您提供支持和一些建议。请注意，我无法替代专业的心理医生。`;
      } else if (agentId === 'business-analyst') {
        aiResponse = `您选择了商业数据分析师。目前我只能基于您提供的文本信息进行模拟分析。请描述您想分析的数据类型和问题，例如：“分析一下过去一年销售额的增长趋势。”`;
      } else {
        // For other agents, use a generic response or existing Pollinations.ai text API
        const encodedPrompt = encodeURIComponent(prompt);
        const apiUrl = `https://text.pollinations.ai/${encodedPrompt}?model=openai-audio&nologo=true`; // Using a generic text model for simulation
        const response = await fetch(apiUrl);
        if (!response.ok) {
          throw new Error(`API响应错误: ${response.status}`);
        }
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          aiResponse += decoder.decode(value, { stream: true });
        }
      }

      // 模拟加载延迟
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      return aiResponse;
    } catch (error) {
      console.error("API调用错误:", error);
      toast({
        title: "智能体调用失败",
        description: "请重试或切换其他智能体",
        variant: "destructive"
      });
      return "抱歉，我在处理您的请求时遇到了问题。请稍后再试。";
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!hasPermission('chat')) {
      toast({ 
        title: "需要会员权限", 
        description: "请升级会员以使用AI对话功能", 
        variant: "destructive" 
      });
      return;
    }

    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    setInput('');

    try {
      // 创建AI消息占位符
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMessage]);

      let responseContent = '';
      if (chatMode === 'general') {
        responseContent = await callTextAPI(currentInput, selectedModel);
      } else { // chatMode === 'agent'
        responseContent = await callAgentAPI(currentInput, selectedAgent);
      }

      // Update the last AI message with the final content
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMsgIndex = newMessages.length - 1;
        if (lastMsgIndex >= 0 && newMessages[lastMsgIndex].role === 'assistant') {
          newMessages[lastMsgIndex] = {
            ...newMessages[lastMsgIndex],
            content: responseContent
          };
        } else {
          // Fallback in case the placeholder wasn't added or was replaced
          newMessages.push({ id: (Date.now() + 2).toString(), role: 'assistant', content: responseContent, timestamp: new Date() });
        }
        return newMessages;
      });

      // 保存聊天记录
      if (user?.id) {
        const chatHistory = {
          id: Date.now().toString(),
          title: currentInput.slice(0, 50) + (currentInput.length > 50 ? '...' : ''),
          timestamp: new Date().toISOString(),
          preview: currentInput.slice(0, 100),
          messages: [...messages, userMessage, { ...aiMessage, content: responseContent }], // Include all messages
          model: selectedModel, // Save selected model
          agent: selectedAgent, // Save selected agent
          mode: chatMode // Save chat mode
        };

        const existingHistory = JSON.parse(localStorage.getItem(`chat_history_${user.id}`) || '[]');
        const updatedHistory = [chatHistory, ...existingHistory].slice(0, 10);
        localStorage.setItem(`chat_history_${user.id}`, JSON.stringify(updatedHistory));
      }
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        title: "发送失败",
        description: "消息发送失败，请重试",
        variant: "destructive"
      });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setChatMode('general'); // Reset to general mode for new chat
    setSelectedModel('gpt-4o-mini'); // Reset to default model
    setSelectedAgent('xiaohongshu-strategist'); // Reset to default agent
  };

  const handleLoadHistory = (historyId: string) => {
    if (user?.id) {
      const existingHistory = JSON.parse(localStorage.getItem(`chat_history_${user.id}`) || '[]');
      const historyItem = existingHistory.find((item: any) => item.id === historyId);
      if (historyItem && historyItem.messages) {
        const loadedMessages = historyItem.messages.map((msg: Message) => ({
          ...msg,
          timestamp: new Date(msg.timestamp)
        }));
        setMessages(loadedMessages);
        setSelectedModel(historyItem.model || 'gpt-4o-mini');
        setSelectedAgent(historyItem.agent || 'xiaohongshu-strategist');
        setChatMode(historyItem.mode || 'general');
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0f1c] via-[#1a1f2e] to-[#0f1419] flex">
      <Navigation />
      
      <div className="flex w-full pt-16">
        {/* 左侧边栏 */}
        <div className="w-80 flex-shrink-0">
          <ChatSidebar 
            onModelChange={setSelectedModel} // Controls selectedModel for general chat
            selectedModel={selectedModel}
            onLoadHistory={handleLoadHistory}
            onNewChat={handleNewChat}
            aiModels={aiTextModels} // Only pass text models here
          />
        </div>

        {/* 主聊天区域 */}
        <div className="flex-1 flex flex-col">
          {/* 会员提示横幅 */}
          {!hasPermission('chat') && (
            <div className="bg-gradient-to-r from-yellow-600/20 to-orange-600/20 border-b border-yellow-500/30 p-4">
              <div className="flex items-center justify-between max-w-4xl mx-auto">
                <div className="flex items-center">
                  <Crown className="w-5 h-5 text-yellow-400 mr-2" />
                  <span className="text-yellow-100">开通会员即可享受15+顶尖AI智能体无限对话</span>
                </div>
                <Link to="/payment">
                  <Button className="bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white px-6 py-2 rounded-full font-medium">
                    立即开通
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {/* 模式/智能体/模型选择提示 */}
          {hasPermission('chat') && (
            <div className="bg-[#1a2740]/50 border-b border-[#203042]/30 p-3">
              <div className="max-w-4xl mx-auto flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400">当前模式:</span>
                  <span className="text-sm text-cyan-400 font-medium">
                    {chatMode === 'general' ? `通用对话 (${aiTextModels.find(m => m.id === selectedModel)?.name})` : `智能体 (${aiAgents.find(a => a.id === selectedAgent)?.name})`}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  {chatMode === 'general' ? `支持 ${aiTextModels.length} 个AI大模型` : `支持 ${aiAgents.length} 个AI智能体`}
                </div>
              </div>
            </div>
          )}

          {/* 聊天消息区域 */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto">
              {messages.length === 0 ? (
                <div className="text-center py-20">
                  <div className="w-16 h-16 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full flex items-center justify-center mx-auto mb-6">
                    <span className="text-2xl">🤖</span>
                  </div>
                  <h2 className="text-3xl font-bold text-white mb-4">开始对话</h2>
                  <p className="text-gray-400 text-lg">选择一个模式，开始您的智能对话之旅</p>
                  <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
                    <Button
                      className={`py-4 text-lg font-medium ${chatMode === 'general' ? 'bg-cyan-600 hover:bg-cyan-700' : 'bg-gray-700 hover:bg-gray-600'}`}
                      onClick={() => setChatMode('general')}
                    >
                      <MessageSquare className="mr-2 h-5 w-5" />
                      通用对话
                    </Button>
                    <Button
                      className={`py-4 text-lg font-medium ${chatMode === 'agent' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-700 hover:bg-gray-600'}`}
                      onClick={() => setChatMode('agent')}
                    >
                      <Wand2 className="mr-2 h-5 w-5" />
                      智能体模式
                    </Button>
                  </div>

                  {chatMode === 'agent' && (
                    <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-3 max-w-2xl mx-auto">
                      {aiAgents.map((agent) => (
                        <div 
                          key={agent.id}
                          className={`p-3 rounded-lg border cursor-pointer transition-all ${
                            selectedAgent === agent.id 
                              ? 'border-cyan-400 bg-cyan-400/10' 
                              : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                          }`}
                          onClick={() => setSelectedAgent(agent.id)}
                        >
                          <div className="text-sm font-medium text-white">{agent.name}</div>
                          <div className="text-xs text-gray-400 mt-1">{agent.group}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  {messages.map((message) => (
                    <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-3xl rounded-2xl px-6 py-4 ${
                        message.role === 'user' 
                          ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white ml-12' 
                          : 'bg-gray-800/80 text-gray-100 mr-12 border border-gray-700'
                      }`}>
                        {message.imageUrl && (
                          <img 
                            src={message.imageUrl} 
                            alt="Generated" 
                            className="w-full max-w-md rounded-lg mb-3"
                          />
                        )}
                        <div className="prose prose-invert max-w-none">
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        </div>
                        <div className="text-xs opacity-70 mt-2">
                          {message.timestamp.toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="bg-gray-800/80 text-gray-100 mr-12 border border-gray-700 rounded-2xl px-6 py-4">
                        <div className="flex items-center space-x-2">
                          <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                          <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                          <span className="text-sm text-gray-400 ml-2">AI正在思考...</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* 输入区域 */}
          <div className="border-t border-gray-700 p-6">
            <div className="max-w-4xl mx-auto">
              {!hasPermission('chat') ? (
                <div className="text-center py-8">
                  <p className="text-gray-400 mb-4">请先升级会员使用AI对话功能</p>
                  <Link to="/payment">
                    <Button className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white px-8 py-3 rounded-full font-medium">
                      立即升级会员
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="flex gap-4">
                  <div className="flex-1">
                    <Textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="输入您的问题..."
                      className="bg-gray-800/50 border-gray-600 text-white placeholder-gray-400 resize-none focus:border-cyan-400 focus:ring-cyan-400/20"
                      rows={1}
                      style={{ minHeight: '48px' }}
                    />
                  </div>
                  <Button
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white px-6 py-3 rounded-xl font-medium h-12 min-w-12"
                  >
                    {isLoading ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Send className="w-5 h-5" />
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Chat;