# shortvid

פרויקט נפרד ליצירת סרטונים קצרים (Pexels + Shotstack + תסריט LLM). **אין קשר ל-ebay-deals.**

## מה כלול

- API + SQLite (jobs, הגדרות, משתמש admin)
- ממשק React: התחברות, יצירת סרטון, היסטוריה, הגדרות
- תזמון cron לריצות אוטומטיות (אופציונלי)

## דרישות סביבה (Render / `.env`)

| משתנה | תיאור |
|--------|--------|
| `JWT_SECRET` | חובה |
| `ADMIN_EMAIL` | ברירת מחדל אם לא מוגדר |
| `ADMIN_PASSWORD` | סיסמת admin ראשונית (שינוי אחרי התחברות) |
| `PEXELS_API_KEY` | חובה לסרטון |
| `SHOTSTACK_API_KEY` | חובה לרינדור |
| `PORT` | לרוב 10000 ב-Render |

אופציונלי: `SHOTSTACK_HOST`, `SHOTSTACK_EDIT_VERSION`

## פיתוח מקומי

```bash
cd shortvid/backend && npm install && npm run dev
```

בטרמינל נפרד:

```bash
cd shortvid/frontend && npm install && npm run dev
```

- UI: http://localhost:5174  
- API: http://localhost:3051  

## GitHub

```bash
cd shortvid
git init
git add .
git commit -m "Initial shortvid"
# צור ריפו ריק ב-GitHub, אחר כך:
git remote add origin https://github.com/YOUR_USER/shortvid.git
git push -u origin main
```

## Render

העתק את `render.yaml` לשירות Web חדש (או הגדר ידנית: build + start כמו בקובץ).
