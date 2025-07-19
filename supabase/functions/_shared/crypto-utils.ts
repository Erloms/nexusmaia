// RSA2 签名和验签工具函数
export class AlipayRSAUtils {
  
  // 将 PEM 格式的私钥转换为 CryptoKey
  static async importPrivateKey(pemKey: string): Promise<CryptoKey> {
    // 清理 PEM 格式
    const pemHeader = "-----BEGIN PRIVATE KEY-----";
    const pemFooter = "-----END PRIVATE KEY-----";
    const pemContents = pemKey
      .replace(pemHeader, "")
      .replace(pemFooter, "")
      .replace(/\s/g, "");
    
    // Base64 解码
    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    
    // 导入私钥
    return await crypto.subtle.importKey(
      "pkcs8",
      binaryDer,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      false,
      ["sign"]
    );
  }

  // 将 PEM 格式的公钥转换为 CryptoKey
  static async importPublicKey(pemKey: string): Promise<CryptoKey> {
    // 清理 PEM 格式
    const pemHeader = "-----BEGIN PUBLIC KEY-----";
    const pemFooter = "-----END PUBLIC KEY-----";
    const pemContents = pemKey
      .replace(pemHeader, "")
      .replace(pemFooter, "")
      .replace(/\s/g, "");
    
    // Base64 解码
    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    
    // 导入公钥
    return await crypto.subtle.importKey(
      "spki",
      binaryDer,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      false,
      ["verify"]
    );
  }

  // 对字符串进行 RSA2 签名
  static async signRSA2(data: string, privateKey: CryptoKey): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      dataBuffer
    );

    // 将签名转换为 Base64
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }

  // 验证 RSA2 签名
  static async verifyRSA2(data: string, signature: string, publicKey: CryptoKey): Promise<boolean> {
    try {
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(data);
      
      // Base64 解码签名
      const signatureBuffer = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
      
      return await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        signatureBuffer,
        dataBuffer
      );
    } catch (error) {
      console.error('签名验证失败:', error);
      return false;
    }
  }

  // 构建支付宝签名字符串
  static buildSignString(params: Record<string, any>): string {
    // 过滤空值并排序
    const filteredParams = Object.keys(params)
      .filter(key => params[key] !== null && params[key] !== undefined && params[key] !== '')
      .sort()
      .reduce((result: Record<string, any>, key) => {
        result[key] = params[key];
        return result;
      }, {});

    // 构建查询字符串
    return Object.keys(filteredParams)
      .map(key => `${key}=${filteredParams[key]}`)
      .join('&');
  }
}