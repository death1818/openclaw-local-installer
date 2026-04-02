/**
 * OpenClaw 微信支付服务
 * 北京缘辉旺网络科技有限公司
 * 
 * 功能：
 * 1. 生成支付二维码
 * 2. 处理支付回调
 * 3. 自动生成授权码
 */

const express = require('express')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const cors = require('cors')
const QRCode = require('qrcode')

// 加载配置
const config = require('./wechat-config')

const app = express()
app.use(cors())
app.use(express.json())

// 存储订单状态（生产环境应使用数据库）
const orders = new Map()

// 存储授权码
const licenseCodes = new Map()

/**
 * 生成授权码
 */
function generateLicenseCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let checksum = 0
  
  // 生成并确保校验和有效
  while (true) {
    const parts = []
    for (let i = 0; i < 3; i++) {
      let part = ''
      for (let j = 0; j < 4; j++) {
        part += chars[Math.floor(Math.random() * chars.length)]
      }
      parts.push(part)
    }
    
    checksum = parts.join('').split('').reduce((sum, c) => sum + c.charCodeAt(0), 0)
    
    if (checksum % 97 === 0 || checksum % 89 === 0 || checksum % 73 === 0) {
      return `OPENCLAW-${parts[0]}-${parts[1]}-${parts[2]}`
    }
  }
}

/**
 * 验证授权码
 */
function validateLicenseCode(code) {
  if (!code || !code.startsWith('OPENCLAW-')) return false
  
  const parts = code.replace('OPENCLAW-', '').split('-')
  if (parts.length !== 3 || parts.some(p => p.length !== 4)) return false
  
  const checksum = parts.join('').split('').reduce((sum, c) => sum + c.charCodeAt(0), 0)
  return checksum % 97 === 0 || checksum % 89 === 0 || checksum % 73 === 0
}

/**
 * 生成微信支付签名
 */
function generateSign(params, apiKey) {
  const sortedParams = Object.keys(params)
    .filter(key => params[key] !== '' && params[key] !== undefined)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&')
  
  return crypto
    .createHmac('sha256', apiKey)
    .update(sortedParams + '&key=' + apiKey)
    .digest('hex')
    .toUpperCase()
}

/**
 * 生成订单号
 */
function generateOrderId() {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `OC${timestamp}${random}`
}

/**
 * API: 创建支付订单
 */
app.post('/api/create-order', async (req, res) => {
  try {
    const orderId = generateOrderId()
    
    // 创建订单
    const order = {
      orderId,
      status: 'pending',
      amount: config.product.price,
      productName: config.product.name,
      createdAt: new Date().toISOString(),
      licenseCode: null
    }
    
    orders.set(orderId, order)
    
    // 如果配置了微信支付，生成支付二维码
    if (config.mchId && config.appId) {
      // 微信支付参数
      const payParams = {
        appid: config.appId,
        mch_id: config.mchId,
        nonce_str: crypto.randomBytes(16).toString('hex'),
        body: config.product.name,
        out_trade_no: orderId,
        total_fee: config.product.price,
        spbill_create_ip: req.ip || '127.0.0.1',
        notify_url: config.notifyUrl,
        trade_type: 'NATIVE'
      }
      
      // 生成签名
      payParams.sign = generateSign(payParams, config.apiKey)
      
      // 这里应该调用微信支付API获取code_url
      // 简化示例：直接返回订单信息
      
      order.payUrl = `weixin://wxpay/bizpayurl?pr=${orderId}`
      
      // 生成二维码图片
      const qrCodeDataUrl = await QRCode.toDataURL(order.payUrl)
      order.qrCode = qrCodeDataUrl
    } else {
      // 测试模式：直接返回订单
      order.testMode = true
    }
    
    res.json({
      success: true,
      order: {
        orderId: order.orderId,
        amount: order.amount,
        productName: order.productName,
        qrCode: order.qrCode,
        testMode: order.testMode
      }
    })
    
  } catch (error) {
    console.error('创建订单失败:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * API: 查询订单状态
 */
app.get('/api/order/:orderId', (req, res) => {
  const order = orders.get(req.params.orderId)
  
  if (!order) {
    return res.status(404).json({ success: false, error: '订单不存在' })
  }
  
  res.json({
    success: true,
    order: {
      orderId: order.orderId,
      status: order.status,
      licenseCode: order.licenseCode
    }
  })
})

/**
 * API: 微信支付回调
 */
app.post('/api/wechat/pay-notify', express.raw({ type: '*/*' }), (req, res) => {
  try {
    // 解析微信通知
    const notifyData = parseXml(req.body.toString())
    
    // 验证签名
    const sign = notifyData.sign
    delete notifyData.sign
    
    const calculatedSign = generateSign(notifyData, config.apiKey)
    
    if (sign !== calculatedSign) {
      return res.send('<xml><return_code><![CDATA[FAIL]]></return_code></xml>')
    }
    
    const orderId = notifyData.out_trade_no
    const order = orders.get(orderId)
    
    if (!order) {
      return res.send('<xml><return_code><![CDATA[FAIL]]></return_code></xml>')
    }
    
    // 更新订单状态
    order.status = 'paid'
    order.paidAt = new Date().toISOString()
    order.transactionId = notifyData.transaction_id
    
    // 生成授权码
    order.licenseCode = generateLicenseCode()
    licenseCodes.set(order.licenseCode, {
      orderId: order.orderId,
      createdAt: order.paidAt
    })
    
    console.log(`✅ 订单支付成功: ${orderId}`)
    console.log(`📋 授权码: ${order.licenseCode}`)
    
    // 返回成功
    res.send('<xml><return_code><![CDATA[SUCCESS]]></return_code></xml>')
    
  } catch (error) {
    console.error('处理支付回调失败:', error)
    res.send('<xml><return_code><![CDATA[FAIL]]></return_code></xml>')
  }
})

/**
 * API: 验证授权码
 */
app.post('/api/validate-license', (req, res) => {
  const { code } = req.body
  
  if (validateLicenseCode(code)) {
    const licenseInfo = licenseCodes.get(code)
    
    res.json({
      success: true,
      valid: true,
      licensed: !!licenseInfo,
      createdAt: licenseInfo?.createdAt
    })
  } else {
    res.json({
      success: true,
      valid: false
    })
  }
})

/**
 * API: 模拟支付（测试用）
 */
app.post('/api/test-pay/:orderId', (req, res) => {
  const order = orders.get(req.params.orderId)
  
  if (!order) {
    return res.status(404).json({ success: false, error: '订单不存在' })
  }
  
  // 模拟支付成功
  order.status = 'paid'
  order.paidAt = new Date().toISOString()
  order.licenseCode = generateLicenseCode()
  
  licenseCodes.set(order.licenseCode, {
    orderId: order.orderId,
    createdAt: order.paidAt
  })
  
  res.json({
    success: true,
    licenseCode: order.licenseCode
  })
})

/**
 * 解析XML
 */
function parseXml(xml) {
  const result = {}
  const regex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>|<(\w+)>(.*?)<\/\3>/g
  let match
  
  while ((match = regex.exec(xml)) !== null) {
    const key = match[1] || match[3]
    const value = match[2] || match[4]
    result[key] = value
  }
  
  return result
}

// 启动服务
const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log('=' .repeat(50))
  console.log('OpenClaw 微信支付服务')
  console.log('北京缘辉旺网络科技有限公司')
  console.log('=' .repeat(50))
  console.log(`服务地址: http://localhost:${PORT}`)
  console.log('')
  console.log('API 端点:')
  console.log(`  POST /api/create-order      - 创建支付订单`)
  console.log(`  GET  /api/order/:orderId    - 查询订单状态`)
  console.log(`  POST /api/validate-license  - 验证授权码`)
  console.log(`  POST /api/test-pay/:orderId - 模拟支付(测试)`)
  console.log('')
  console.log('请先配置 payment/wechat-config.js 文件')
  console.log('=' .repeat(50))
})

module.exports = app
