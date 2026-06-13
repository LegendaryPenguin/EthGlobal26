import { useState } from "react";
import { useStore } from "../store";
import { Button } from "../components/ui";
import { FoxLogo } from "../components/Icons";
import { useWallet } from "../web3/useLender";

// Faithful MetaMask unlock screen (the iconic "Welcome back!" login). Mocked — any
// password unlocks. DESIGN_SPEC §4 (entry gate added in the dark-mode pass).
export function Login() {
  const { dispatch } = useStore();
  const { connect, isConnected, isPending } = useWallet();
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const unlock = () => dispatch({ type: "unlock" });

  const connectReal = async () => {
    setErr(null);
    try {
      if (!isConnected) await connect();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      // wagmi throws "Connector already connected" if a session is live — that's fine.
      if (!/already connected/i.test(msg)) {
        setErr(msg || "Connection cancelled");
        return;
      }
    }
    dispatch({ type: "unlock" });
  };

  return (
    <div className="login">
      <div className="login__col">
        <div className="login__fox">
          <FoxLogo size={96} />
        </div>
        <h1 className="t-heading-lg login__title">Welcome back!</h1>
        <p className="t-body-md text-alt login__sub">The decentralized web awaits</p>

        <form
          className="login__form"
          onSubmit={(e) => {
            e.preventDefault();
            unlock();
          }}
        >
          <label className="login__label t-body-sm-medium">Password</label>
          <div className="login__input">
            <input
              type={show ? "text" : "password"}
              autoFocus
              placeholder="Password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
            <button type="button" className="login__eye" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide" : "Show"}>
              {show ? "Hide" : "Show"}
            </button>
          </div>

          <Button full size="lg" type="submit" className="login__btn">Unlock</Button>
        </form>

        <div className="login__divider t-body-xs text-muted"><span>or</span></div>
        <Button variant="secondary" full size="lg" onClick={connectReal} disabled={isPending}>
          {isPending ? "Connecting…" : isConnected ? "Continue · wallet connected →" : "Connect MetaMask (live)"}
        </Button>
        {err && <p className="t-body-xs text-error" style={{ marginTop: 10 }}>{err}</p>}

        <button className="textlink login__forgot" onClick={unlock}>Forgot password?</button>

        <div className="login__foot t-body-sm text-alt">
          Need help? Contact <span className="login__link">MetaMask support</span>
        </div>
      </div>
    </div>
  );
}
