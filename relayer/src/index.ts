import { app } from './server';
import { PORT } from './config';

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[Relayer] CrossVault relayer service running on http://localhost:${PORT}`);
  });
}

export default app;
