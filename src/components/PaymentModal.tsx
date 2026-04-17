import { useState, useEffect } from 'react'

interface PaymentModalProps {
  isOpen: boolean
  onClose: () => void
  onPaid: (licenseCode: string) => void
}

interface Order {
  orderId: string
  amount: number
  productName: string
  qrCode?: string
  testMode?: boolean
}

export function PaymentModal({ isOpen, onClose, onPaid }: PaymentModalProps) {
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(false)
  const [licenseCode, setLicenseCode] = useState('')
  const [error, setError] = useState('')
  
  // 支付服务地址
  const PAYMENT_SERVER = 'https://www.ku1818.cn/api/license'

  // 创建订单
  const createOrder = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${PAYMENT_SERVER}/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await res.json()
      if (data.success) {
        // 适配后端返回格式
        setOrder({
          orderId: data.order_id,
          amount: data.amount,
          productName: 'OpenClaw本地版安装授权',
          qrCode: data.qr_code
        })
      } else {
        setError(data.error || '创建订单失败')
      }
    } catch (err) {
      setError('创建订单失败，请检查网络连接')
    }
    setLoading(false)
  }

  // 轮询订单状态
  useEffect(() => {
    if (!order || order.testMode) return
    
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${PAYMENT_SERVER}/check-order/${order.orderId}`)
        const data = await res.json()
        
        if (data.success && data.status === 'paid') {
          onPaid(data.license_code)
          clearInterval(interval)
        }
      } catch (err) {
        console.error('查询订单失败:', err)
      }
    }, 3000)
    
    return () => clearInterval(interval)
  }, [order])

  // 测试模式：模拟支付
  const testPay = async () => {
    if (!order) return
    try {
      const res = await fetch(`${PAYMENT_SERVER}/api/test-pay/${order.orderId}`, {
        method: 'POST'
      })
      const data = await res.json()
      if (data.success) {
        onPaid(data.licenseCode)
      }
    } catch (err) {
      setError('模拟支付失败')
    }
  }

  // 验证授权码
  const validateCode = async () => {
    if (!licenseCode) {
      setError('请输入授权码')
      return
    }
    
    setLoading(true)
    try {
      const res = await fetch(`${PAYMENT_SERVER}/validate-license`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: licenseCode.toUpperCase() })
      })
      const data = await res.json()
      
      if (data.success && data.valid) {
        onPaid(licenseCode.toUpperCase())
      } else {
        // 显示服务器返回的错误消息
        setError(data.message || '授权码无效')
      }
    } catch (err) {
      console.error('验证授权码失败:', err)
      setError('网络错误，请检查网络连接后重试')
    }
    setLoading(false)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <h2 className="text-2xl font-bold text-center mb-6">软件授权</h2>
        
        {!order ? (
          <div className="text-center">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6 mb-6">
              <p className="text-gray-700 dark:text-gray-300 mb-2">
                安装服务费
              </p>
              <p className="text-4xl font-bold text-blue-600">
                ¥66.66
              </p>
            </div>
            
            <button
              onClick={createOrder}
              disabled={loading}
              className="w-full py-3 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 disabled:opacity-50"
            >
              {loading ? '加载中...' : '微信扫码支付'}
            </button>
            
            <div className="mt-4 text-center">
              <span className="text-gray-500">或</span>
            </div>
            
            <div className="mt-4 space-y-3">
              <input
                type="text"
                placeholder="输入授权码: OPENCLAW-XXXX-XXXX-XXXX"
                value={licenseCode}
                onChange={(e) => setLicenseCode(e.target.value.toUpperCase())}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-center font-mono"
              />
              
              {error && (
                <p className="text-red-500 text-sm text-center">{error}</p>
              )}
              
              <button
                onClick={validateCode}
                disabled={loading || !licenseCode}
                className="w-full py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50"
              >
                验证授权码
              </button>
            </div>
            
            <button
              onClick={onClose}
              className="w-full mt-4 py-2 text-gray-500 hover:text-gray-700"
            >
              取消
            </button>
          </div>
        ) : (
          <div className="text-center">
            {order.testMode ? (
              <div>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  测试模式
                </p>
                <p className="text-sm text-gray-500 mb-6">
                  订单号: {order.orderId}
                </p>
                <button
                  onClick={testPay}
                  className="w-full py-3 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600"
                >
                  模拟支付成功
                </button>
              </div>
            ) : (
              <div>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  请使用微信扫码支付
                </p>
                
                {order.qrCode && (
                  <div className="bg-white p-4 rounded-lg inline-block mb-4">
                    <img src={order.qrCode} alt="支付二维码" className="w-48 h-48" />
                  </div>
                )}
                
                <p className="text-sm text-gray-500">
                  订单号: {order.orderId}
                </p>
                <p className="text-lg font-bold text-blue-600 mt-2">
                  ¥{order.amount.toFixed(2)}
                </p>
                <p className="text-sm text-gray-500 mt-4">
                  支付完成后将自动跳转...
                </p>
              </div>
            )}
            
            <button
              onClick={() => setOrder(null)}
              className="w-full mt-6 py-2 text-gray-500 hover:text-gray-700"
            >
              返回
            </button>
          </div>
        )}
        
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-400 text-center">
            © 2026 北京缘辉旺网络科技有限公司
          </p>
        </div>
      </div>
    </div>
  )
}
