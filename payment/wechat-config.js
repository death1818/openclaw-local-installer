/**
 * 微信支付配置
 * 北京缘辉旺网络科技有限公司
 */

module.exports = {
  // 微信支付商户号
  mchId: '1245844102',
  
  // 应用ID (公众号)
  appId: 'wx791632756c4e0f9c',
  
  // API密钥 (APIv2密钥)
  apiKey: 'sdjHTyzVQjmGlKhwqMync0WNXsUMmq1u',
  
  // APIv3密钥 (如果使用新版API)
  apiV3Key: '', // 暂不使用
  
  // 商户证书序列号
  serialNo: '', // 暂不使用
  
  // 商户证书路径
  certPath: './certs/apiclient_cert.pem',
  
  // 商户私钥路径
  privateKeyPath: './certs/apiclient_key.pem',
  
  // 支付回调通知地址
  notifyUrl: 'https://yunying.yuanhuiwang.com/api/wechat/pay-notify',
  
  // 商品信息
  product: {
    name: 'OpenClaw本地版安装服务',
    description: 'OpenClaw本地版软件安装授权',
    price: 6666, // 单位：分 (66.66元)
  }
}
