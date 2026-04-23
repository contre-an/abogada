import requests
content = 'phone\n+573001234567\n+573001234568\n'
files = {'file': ('test.csv', content, 'text/csv')}
url = 'https://abogada.onrender.com/api/upload-excel'
try:
    r = requests.post(url, files=files, timeout=30)
    print(r.status_code)
    print(r.text)
except Exception as e:
    print('ERROR', type(e).__name__, e)
