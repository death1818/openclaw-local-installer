/**
 * 微信支付配置
 * 请填入你的微信支付商户信息
 */

module.exports = {
  // 微信支付商户号
  mchId: '1245844102',
  
  // 应用ID (小程序/公众号) - 请填写
  appId: '', // 例如: wx1234567890abcdef
  
  // API密钥 (在微信支付商户平台设置) - 请填写
  apiKey: '', // 32位字符串
  
  // APIv3密钥 (如果使用新版API) - 请填写
  apiV3Key: '', // 32位字符串
  
  // 商户证书序列号 - 请填写
  serialNo: '', // 商户API证书序列号
  
  // 商户私钥路径 (用于签名)
  privateKeyPath: './certs/apiclient_key.pem',
  
  // 支付回调通知地址 (必须是HTTPS)
  notifyUrl: 'https://yunying.yuanhuiwang.com/api/wechat/pay-notify',
  
  // 商品信息
  product: {
    name: 'OpenClaw本地版安装服务',
    description: 'OpenClaw本地版软件安装授权',
    price: 6666, // 单位：分 (66.66元)
  }
}
