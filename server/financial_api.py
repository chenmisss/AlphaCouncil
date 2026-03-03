#!/usr/bin/env python3
"""
Financial Data API using Baostock
一利五率 + 毛利率变化分析
自动判断最新可用财报期
"""

from flask import Flask, jsonify
import baostock as bs
import datetime

app = Flask(__name__)

def get_latest_report_period():
    """
    根据当前日期判断最新可用的财报期
    A股财报发布规则：
    - Q1报告：4月30日前发布
    - 半年报(Q2)：8月31日前发布  
    - Q3报告：10月31日前发布
    - 年报(Q4)：次年4月30日前发布
    
    返回 (year, [quarters]) - 按优先级排序的季度列表
    """
    today = datetime.date.today()
    year = today.year
    month = today.month
    day = today.day
    
    # 判断当前最新可用的报告期
    if month >= 11:
        # 11-12月：Q3报告已发布，优先获取当年Q3
        return year, [3, 2, 1]
    elif month >= 9:
        # 9-10月：Q3可能还在发布中，先尝试Q3，回退到Q2
        if month == 10 and day > 31:
            return year, [3, 2, 1]
        else:
            return year, [2, 1, 3]  # 优先取Q2，因为Q3可能还没出
    elif month >= 5:
        # 5-8月：Q1和半年报
        if month >= 9:
            return year, [2, 1]
        elif month >= 5:
            return year, [1, 2]  # Q1肯定出了
        return year, [1]
    elif month >= 2:
        # 2-4月：去年年报和Q3可能已有，今年Q1还没出
        # 尝试获取去年的Q3或年报
        return year - 1, [3, 2, 1]
    else:
        # 1月：去年Q3最新
        return year - 1, [3, 2, 1]

def get_stock_code(symbol: str) -> str:
    """Convert stock symbol to baostock format (sh.600519 or sz.300024)"""
    symbol = symbol.lower().strip()
    
    if symbol.startswith('sh') or symbol.startswith('sz'):
        prefix = symbol[:2]
        code = symbol[2:]
        return f"{prefix}.{code}"
    
    if symbol.startswith('6') or symbol.startswith('9'):
        return f"sh.{symbol}"
    else:
        return f"sz.{symbol}"

def safe_float(val):
    """Safely convert to float, return None if invalid"""
    if val is None or val == '' or val == 'None':
        return None
    try:
        return float(val)
    except:
        return None

@app.route('/api/fundamental/<symbol>')
def get_fundamental(symbol):
    """Get fundamental financial indicators - 一利五率 style"""
    try:
        lg = bs.login()
        if lg.error_code != '0':
            return jsonify({'success': False, 'error': f'Login failed: {lg.error_msg}'})
        
        stock_code = get_stock_code(symbol)
        
        # 获取当前最新可用的报告期
        latest_year, quarter_priority = get_latest_report_period()
        print(f"[Financial API] 当前日期: {datetime.date.today()}, 目标报告期: {latest_year}年, 季度优先级: {quarter_priority}")
        
        # ========== 利润数据 ==========
        # 字段: code, pubDate, statDate, roeAvg, npMargin, gpMargin, netProfit, epsTTM, MBRevenue, totalShare, liqaShare
        profit_data = {}
        for quarter in quarter_priority:
            profit_result = bs.query_profit_data(code=stock_code, year=latest_year, quarter=quarter)
            while profit_result.next():
                row = profit_result.get_row_data()
                if row and len(row) > 6:
                    net_profit = safe_float(row[6])
                    profit_data = {
                        'reportPeriod': row[2] if len(row) > 2 else None,  # statDate
                        'currentQuarter': quarter,             # 当前是第几季度
                        'roe': safe_float(row[3]),             # roeAvg
                        'netProfitMargin': safe_float(row[4]), # npMargin
                        'grossProfitMargin': safe_float(row[5]),  # gpMargin 毛利率
                        'netProfit': net_profit,               # 累计净利润
                        'netProfitAnnualized': net_profit * 4 / quarter if net_profit and quarter else None,  # 年化预估
                        'epsTTM': safe_float(row[7]),          # epsTTM 每股收益(TTM)
                        'totalShares': safe_float(row[9]),     # totalShare 总股本
                    }
                    break
            if profit_data:
                break
        
        # 获取上一期毛利率用于计算变化率
        prev_gpm = None
        for quarter in quarter_priority[1:]:
            prev_result = bs.query_profit_data(code=stock_code, year=latest_year, quarter=quarter)
            while prev_result.next():
                row = prev_result.get_row_data()
                if row and len(row) > 5 and row[5]:
                    prev_gpm = safe_float(row[5])
                    break
        
        # 上一年同期（如果当年没有数据）
        if prev_gpm is None:
            prev_result = bs.query_profit_data(code=stock_code, year=latest_year-1, quarter=3)
            while prev_result.next():
                row = prev_result.get_row_data()
                if row and len(row) > 5 and row[5]:
                    prev_gpm = safe_float(row[5])
                    break
        
        # 计算毛利率变化
        gpm_change = None
        if profit_data.get('grossProfitMargin') and prev_gpm:
            gpm_change = profit_data['grossProfitMargin'] - prev_gpm
        
        # ========== 成长数据 ==========
        # 字段: code, pubDate, statDate, YOYEquity, YOYAsset, YOYNI, YOYEPSBasic, YOYPNI
        growth_data = {}
        for quarter in quarter_priority:
            growth_result = bs.query_growth_data(code=stock_code, year=latest_year, quarter=quarter)
            while growth_result.next():
                row = growth_result.get_row_data()
                if row and len(row) > 5:
                    growth_data = {
                        'yoyEquity': safe_float(row[3]),   # 净资产同比
                        'yoyAsset': safe_float(row[4]),    # 总资产同比
                        'yoyNetProfit': safe_float(row[5]), # 净利润同比
                    }
                    break
            if growth_data:
                break
        
        # ========== 现金流数据 ==========
        # 字段: code, pubDate, statDate, CAToAsset, NCAToAsset, tangibleAssetToAsset, ebitToInterest, CFOToOR, CFOToNP, CFOToGr
        cashflow_data = {}
        for quarter in quarter_priority:
            cf_result = bs.query_cash_flow_data(code=stock_code, year=latest_year, quarter=quarter)
            while cf_result.next():
                row = cf_result.get_row_data()
                if row and len(row) > 8:
                    cashflow_data = {
                        'cfoToRevenue': safe_float(row[7]),  # CFOToOR 经营现金流/营收
                        'cfoToNetProfit': safe_float(row[8]), # CFOToNP 经营现金流/净利润
                    }
                    break
            if cashflow_data:
                break
        
        # ========== 运营数据 ==========
        # 字段: code, pubDate, statDate, NRTurnRatio, NRTurnDays, INVTurnRatio, INVTurnDays, CATurnRatio, AssetTurnRatio
        operation_data = {}
        for quarter in quarter_priority:
            op_result = bs.query_operation_data(code=stock_code, year=latest_year, quarter=quarter)
            while op_result.next():
                row = op_result.get_row_data()
                if row and len(row) > 8:
                    operation_data = {
                        'receivableTurnover': safe_float(row[3]),  # 应收账款周转率
                        'inventoryTurnover': safe_float(row[5]),   # 存货周转率
                        'assetTurnover': safe_float(row[8]),       # 资产周转率
                    }
                    break
            if operation_data:
                break
        
        # ========== 负债数据 ==========
        balance_result = bs.query_balance_data(code=stock_code, year=latest_year, quarter=quarter_priority[0])
        debt_ratio = None
        while balance_result.next():
            row = balance_result.get_row_data()
            if len(row) > 4:
                total_asset = safe_float(row[3])
                total_liab = safe_float(row[4])
                if total_asset and total_liab:
                    debt_ratio = total_liab / total_asset * 100
        
        bs.logout()
        
        # ========== 历史年报数据（近3年对比）==========
        # 重新登录获取历史数据
        bs.login()
        
        historical_data = []
        current_year = datetime.date.today().year
        years_to_fetch = [current_year - 1, current_year - 2, current_year - 3]
        
        for hist_year in years_to_fetch:
            year_data = {'year': hist_year}
            
            # 获取年报数据 (Q4)，如果没有则用Q3
            for q in [4, 3]:
                profit_result = bs.query_profit_data(code=stock_code, year=hist_year, quarter=q)
                while profit_result.next():
                    row = profit_result.get_row_data()
                    if row and len(row) > 6:
                        year_data['roe'] = safe_float(row[3])
                        year_data['grossProfitMargin'] = safe_float(row[5])
                        year_data['netProfitMargin'] = safe_float(row[4])
                        year_data['netProfit'] = safe_float(row[6])
                        year_data['quarter'] = q
                        break
                if year_data.get('roe') is not None:
                    break
            
            # 获取负债率
            for q in [4, 3]:
                balance_result = bs.query_balance_data(code=stock_code, year=hist_year, quarter=q)
                while balance_result.next():
                    row = balance_result.get_row_data()
                    if len(row) > 4:
                        total_asset = safe_float(row[3])
                        total_liab = safe_float(row[4])
                        if total_asset and total_liab:
                            year_data['debtRatio'] = total_liab / total_asset * 100
                            break
                if year_data.get('debtRatio') is not None:
                    break
            
            if year_data.get('roe') is not None or year_data.get('debtRatio') is not None:
                historical_data.append(year_data)
        
        bs.logout()
        
        # 汇总结果 - 一利五率格式
        result = {
            'success': True,
            'code': stock_code,
            'data': {
                # 一利: 利润总额
                'netProfit': profit_data.get('netProfit'),
                'netProfitAnnualized': profit_data.get('netProfitAnnualized'),  # 年化预估
                'currentQuarter': profit_data.get('currentQuarter'),            # 第几季度
                
                # 估值指标 (用于计算 PE/PB)
                'epsTTM': profit_data.get('epsTTM'),              # 每股收益(TTM)
                'totalShares': profit_data.get('totalShares'),    # 总股本
                
                # 五率
                'roe': profit_data.get('roe'),                    # 净资产收益率
                'debtRatio': f"{debt_ratio:.2f}" if debt_ratio else None,  # 资产负债率
                'grossProfitMargin': profit_data.get('grossProfitMargin'),  # 毛利率
                'grossProfitMarginChange': gpm_change,            # 毛利率变化
                'netProfitMargin': profit_data.get('netProfitMargin'),      # 净利率
                'cfoToRevenue': cashflow_data.get('cfoToRevenue'),  # 营业现金比率
                'cfoToNetProfit': cashflow_data.get('cfoToNetProfit'),  # 现金流/净利润
                
                # 成长性
                'yoyNetProfit': growth_data.get('yoyNetProfit'),  # 净利润同比
                'yoyAsset': growth_data.get('yoyAsset'),          # 总资产同比
                
                # 运营效率
                'assetTurnover': operation_data.get('assetTurnover'),  # 资产周转率
                'receivableTurnover': operation_data.get('receivableTurnover'),  # 应收周转率
                'inventoryTurnover': operation_data.get('inventoryTurnover'),  # 存货周转率
                
                # 🆕 历史年报对比（近3年）
                'historicalData': historical_data,
                
                # 元信息
                'reportPeriod': profit_data.get('reportPeriod', '2024Q3'),
                'updateTime': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }
        }
        
        return jsonify(result)
        
    except Exception as e:
        try:
            bs.logout()
        except:
            pass
        return jsonify({'success': False, 'error': str(e)})

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002)
