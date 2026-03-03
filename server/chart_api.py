#!/usr/bin/env python3
"""
K-Line Chart Generator API
生成专业 K 线图供 AI 分析
"""

from flask import Flask, send_file, jsonify
import requests
import pandas as pd
import mplfinance as mpf
import matplotlib
matplotlib.use('Agg')  # 无头模式
import matplotlib.pyplot as plt
# 设置中文字体
plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans', 'Arial Unicode MS', 'sans-serif']
plt.rcParams['axes.unicode_minus'] = False
import io
import datetime

app = Flask(__name__)

def get_stock_code_em(symbol: str) -> str:
    """Convert stock symbol to East Money format (0.300024 or 1.600519)"""
    symbol = symbol.lower().strip()
    
    if symbol.startswith('6') or symbol.startswith('9'):
        return f"1.{symbol}"  # 上海
    else:
        return f"0.{symbol}"  # 深圳

@app.route('/api/kline-chart/<symbol>')
def generate_kline_chart(symbol):
    """Generate K-line chart image for the given stock symbol"""
    try:
        # 获取 K 线数据（30天）
        em_code = get_stock_code_em(symbol)
        url = f"https://push2his.eastmoney.com/api/qt/stock/kline/get"
        params = {
            "secid": em_code,
            "fields1": "f1,f2,f3,f4,f5,f6",
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
            "klt": "101",  # 日K
            "fqt": "1",    # 前复权
            "end": "20500101",
            "lmt": "30"    # 获取30天数据
        }
        
        response = requests.get(url, params=params, timeout=10)
        data = response.json()
        
        if not data.get('data') or not data['data'].get('klines'):
            return jsonify({'success': False, 'error': 'No kline data found'})
        
        stock_name = data['data'].get('name', symbol)
        klines = data['data']['klines']
        
        # 解析 K 线数据
        rows = []
        for kline in klines:
            parts = kline.split(',')
            if len(parts) >= 6:
                rows.append({
                    'Date': pd.to_datetime(parts[0]),
                    'Open': float(parts[1]),
                    'Close': float(parts[2]),
                    'High': float(parts[3]),
                    'Low': float(parts[4]),
                    'Volume': float(parts[5])
                })
        
        df = pd.DataFrame(rows)
        df.set_index('Date', inplace=True)
        
        # 计算均线
        df['MA5'] = df['Close'].rolling(window=5).mean()
        df['MA10'] = df['Close'].rolling(window=10).mean()
        df['MA20'] = df['Close'].rolling(window=20).mean()
        
        # 生成 K 线图
        mc = mpf.make_marketcolors(
            up='red', down='green',  # A股红涨绿跌
            edge='inherit',
            wick='inherit',
            volume='inherit'
        )
        
        s = mpf.make_mpf_style(
            marketcolors=mc,
            gridstyle='-',
            gridcolor='#2a2a2a',
            facecolor='#1a1a2e',
            figcolor='#1a1a2e',
            edgecolor='#333'
        )
        
        # 添加均线
        add_plots = [
            mpf.make_addplot(df['MA5'], color='yellow', width=0.8),
            mpf.make_addplot(df['MA10'], color='cyan', width=0.8),
            mpf.make_addplot(df['MA20'], color='magenta', width=0.8),
        ]
        
        # 创建图表
        buf = io.BytesIO()
        fig, axes = mpf.plot(
            df,
            type='candle',
            style=s,
            title=f'{stock_name} ({symbol.upper()}) K线图',
            ylabel='价格',
            ylabel_lower='成交量',
            volume=True,
            addplot=add_plots,
            figsize=(12, 8),
            returnfig=True
        )
        
        # 添加均线图例
        axes[0].legend(['MA5', 'MA10', 'MA20'], loc='upper left', fontsize=8)
        
        fig.savefig(buf, format='png', dpi=100, bbox_inches='tight', 
                   facecolor='#1a1a2e', edgecolor='none')
        buf.seek(0)
        
        return send_file(buf, mimetype='image/png')
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5003)
