import React, { useState, useEffect } from 'react';
import { Settings, Save, Eye, EyeOff } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch'; // Import Switch component
import { supabase } from '@/integrations/supabase/client'; // Import supabase client

const PaymentConfig = () => {
  const [config, setConfig] = useState({
    alipay_app_id: '',
    alipay_private_key: '',
    alipay_public_key: '',
    app_public_key: '', // New field for app_public_key
    alipay_gateway_url: 'https://openapi.alipay.com/gateway.do',
    notify_url: '',
    return_url: '',
    is_sandbox: false, // New field for sandbox mode
  });
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchConfig = async () => {
      setLoading(true);
      try {
        // Call the Supabase Edge Function directly
        const { data, error } = await supabase.functions.invoke('payment-config', {
          method: 'GET',
        });

        if (error) {
          // If no config found (PGRST116), data will be null, which is handled by `data || {}`
          // For other errors, throw it
          if (error.status !== 404) { // 404 might indicate function not found or no data
            throw error;
          }
        }
        
        if (data) {
          setConfig(prevConfig => ({
            ...prevConfig,
            ...data // Merge fetched data, keeping defaults if not present
          }));
        }
      } catch (error: any) {
        console.error('Error fetching payment config:', error);
        toast({
          title: "加载配置失败",
          description: error.message || "无法从服务器获取支付宝配置",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      // Call the Supabase Edge Function directly
      const { data, error } = await supabase.functions.invoke('payment-config', {
        method: 'POST',
        body: config // Send the entire config object
      });

      if (error) throw error;

      toast({
        title: "配置保存成功",
        description: "支付宝配置已更新",
      });
    } catch (error: any) {
      console.error('Error saving payment config:', error);
      toast({
        title: "保存失败",
        description: error.message || "请检查配置信息",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-6 w-6 text-nexus-cyan" />
        <h2 className="text-2xl font-bold text-gradient">支付配置管理</h2>
      </div>

      <Tabs defaultValue="alipay" className="w-full">
        <TabsList className="bg-[#1a2740] border-[#203042]/60">
          <TabsTrigger value="alipay" className="data-[state=active]:bg-cyan-600">支付宝配置</TabsTrigger>
          <TabsTrigger value="settings" className="data-[state=active]:bg-cyan-600">回调设置</TabsTrigger>
        </TabsList>

        <TabsContent value="alipay">
          <Card className="bg-[#1a2740] border-[#203042]/60">
            <CardHeader>
              <CardTitle className="text-white">支付宝应用信息</CardTitle>
              <CardDescription className="text-gray-400">
                请在支付宝开放平台获取应用信息并填入以下配置
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="app_id" className="text-white">应用 ID (App ID)</Label>
                <Input
                  id="app_id"
                  value={config.alipay_app_id}
                  onChange={(e) => setConfig({...config, alipay_app_id: e.target.value})}
                  placeholder="请输入支付宝应用ID"
                  className="bg-[#14202c] border-[#2e4258] text-white"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="private_key" className="text-white">应用私钥 (Private Key)</Label>
                <div className="relative">
                  <Textarea
                    id="private_key"
                    value={config.alipay_private_key}
                    onChange={(e) => setConfig({...config, alipay_private_key: e.target.value})}
                    placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                    className="min-h-32 bg-[#14202c] border-[#2e4258] text-white"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-2 text-gray-400 hover:text-white"
                    onClick={() => setShowPrivateKey(!showPrivateKey)}
                  >
                    {showPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="app_public_key" className="text-white">应用公钥 (App Public Key)</Label>
                <Textarea
                  id="app_public_key"
                  value={config.app_public_key || ''} // Ensure it's not null
                  onChange={(e) => setConfig({...config, app_public_key: e.target.value})}
                  placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----"
                  className="min-h-32 bg-[#14202c] border-[#2e4258] text-white"
                />
                <p className="text-xs text-gray-400 mt-1">
                  这是您在支付宝开放平台上传的**应用公钥**，用于支付宝验证您的请求签名。
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="alipay_public_key" className="text-white">支付宝公钥 (Alipay Public Key)</Label>
                <Textarea
                  id="alipay_public_key"
                  value={config.alipay_public_key}
                  onChange={(e) => setConfig({...config, alipay_public_key: e.target.value})}
                  placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----"
                  className="min-h-32 bg-[#14202c] border-[#2e4258] text-white"
                />
                <p className="text-xs text-gray-400 mt-1">
                  这是支付宝提供给您的**支付宝公钥**，用于您验证支付宝的回调通知签名。
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="gateway_url" className="text-white">网关地址</Label>
                <Input
                  id="gateway_url"
                  value={config.alipay_gateway_url}
                  onChange={(e) => setConfig({...config, alipay_gateway_url: e.target.value})}
                  placeholder="https://openapi.alipay.com/gateway.do"
                  className="bg-[#14202c] border-[#2e4258] text-white"
                />
                <p className="text-xs text-gray-400 mt-1">
                  支付宝官方API网关地址，生产环境通常为 `https://openapi.alipay.com/gateway.do`。
                </p>
              </div>

              <div className="flex items-center justify-between space-x-2">
                <Label htmlFor="is_sandbox" className="text-white">沙箱模式</Label>
                <Switch
                  id="is_sandbox"
                  checked={config.is_sandbox}
                  onCheckedChange={(checked) => {
                    setConfig(prev => ({
                      ...prev,
                      is_sandbox: checked,
                      alipay_gateway_url: checked 
                        ? 'https://openapi.alipaydev.com/gateway.do' 
                        : 'https://openapi.alipay.com/gateway.do'
                    }));
                    toast({
                      title: "沙箱模式切换",
                      description: `已切换到${checked ? '沙箱环境' : '生产环境'}，网关地址已自动更新。`,
                    });
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card className="bg-[#1a2740] border-[#203042]/60">
            <CardHeader>
              <CardTitle className="text-white">回调设置</CardTitle>
              <CardDescription className="text-gray-400">
                配置支付成功后的回调地址
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="notify_url" className="text-white">异步通知地址 (Notify URL)</Label>
                <Input
                  id="notify_url"
                  value={config.notify_url}
                  onChange={(e) => setConfig({...config, notify_url: e.target.value})}
                  placeholder="https://your-domain.com/api/alipay/notify"
                  className="bg-[#14202c] border-[#2e4258] text-white"
                />
                <p className="text-xs text-gray-400 mt-1">
                  支付宝会向此地址发送异步支付结果通知。
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="return_url" className="text-white">同步返回地址 (Return URL)</Label>
                <Input
                  id="return_url"
                  value={config.return_url}
                  onChange={(e) => setConfig({...config, return_url: e.target.value})}
                  placeholder="https://your-domain.com/payment/success"
                  className="bg-[#14202c] border-[#2e4258] text-white"
                />
                <p className="text-xs text-gray-400 mt-1">
                  用户支付完成后，支付宝会同步重定向到此地址。
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Button onClick={handleSave} disabled={loading} className="w-full bg-cyan-600 hover:bg-cyan-700 text-white">
        <Save className="h-4 w-4 mr-2" />
        {loading ? '保存中...' : '保存配置'}
      </Button>
    </div>
  );
};

export default PaymentConfig;