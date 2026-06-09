export const profile = {
  name: "Luan Biagioni",
  handle: "luanlbmk93",
  role: "Desenvolvedor de Software",
  tagline:
    "Backend, fullstack e blockchain — do contrato inteligente à API em produção.",
  email: "luan@odevcwb.com",
  location: "Brasil",
  links: {
    github: "https://github.com/luanlbmk93",
    linkedin: "https://www.linkedin.com/in/luan-biagioni/",
    instagram: "https://www.instagram.com/odevcwb",
  },
};

export const terminalLines = [
  { cmd: "whoami", out: "luanlbmk93 — backend · fullstack · blockchain" },
  { cmd: "cat stack.json", out: '{ "lang": ["ts","py","sol"], "focus": "web3" }' },
  { cmd: "gh repo list --limit 3", out: "buybot · nft-generator · coin-dropper" },
];

export const dogita = {
  name: "DOGITA",
  subtitle: "Dogecoin's girlfriend — ecossistema multichain de ponta a ponta",
  role: "Diretor de Tecnologia (CTO)",
  peakMarketCap: "$9M+",
  holders: "10.000+",
  supply: "100B DOGA",
  listing: "CoinMarketCap · CoinGecko · LBank · Bitmart",
  description:
    "Liderei a engenharia de um dos maiores memecoins multichain do mercado. Da arquitetura de contratos ao frontend de produção, passei por staking, dividendos em ouro on-chain, NFTs com utilidade, migração 1:1 para holders OG e o roadmap de uma L1 própria — Dogita Chain.",
  narrative:
    "A comunidade OG levou o projeto a mais de US$ 9 milhões em valor de mercado. Construí a stack técnica que sustentou esse crescimento: contratos auditados pela CertiK, tokenomics transparente on-chain, infra multichain (ETH, BSC, Base, Solana) e a fundação de uma blockchain EVM Proof-of-Authority com DEX, explorer e token factory.",
  links: {
    site: "https://dogita.io",
    whitepaper: "https://dogita.gitbook.io/dogita-whitepaper",
    cmc: "https://coinmarketcap.com/currencies/dogita/",
    telegram: "https://t.me/dogitaofficial",
  },
  metrics: [
    { value: "$9M+", label: "pico de market cap" },
    { value: "10K+", label: "holders globais" },
    { value: "4", label: "redes (ETH·BSC·Base·SOL)" },
    { value: "CertiK", label: "audit · KYC · renounced" },
  ],
  techStack: [
    "Solidity",
    "Hardhat",
    "ethers.js",
    "React",
    "TypeScript",
    "Besu PoA",
    "EVM",
    "IPFS",
    "Web3",
  ],
  modules: [
    {
      icon: "⬡",
      title: "Contratos Multichain",
      desc: "DOGA deployado em Ethereum, BSC, Base e Solana — mesma identidade, infra adaptada por rede.",
    },
    {
      icon: "◈",
      title: "Tokenomics On-chain",
      desc: "100B supply com buckets auditáveis: staking (30%), LP, migração OG, treasury, marketing e team — saldos públicos por wallet.",
    },
    {
      icon: "⚡",
      title: "Staking & Dividendos XAUT",
      desc: "Protocolo de stake com recompensas + engine de dividendos em XAUT (ouro tokenizado) distribuídos aos holders a cada trade.",
    },
    {
      icon: "🖼",
      title: "NFT Collection",
      desc: "Coleção generativa com utilidade real: boosts de staking, acesso VIP e integração ao ecossistema Dogita.",
    },
    {
      icon: "⇄",
      title: "Portal de Migração 1:1",
      desc: "Swap garantido old DOGITA → new DOGA para holders OG — mesmo amount, zero penalty, entrega instantânea on-chain.",
    },
    {
      icon: "🛡",
      title: "Segurança CertiK",
      desc: "Smart contracts auditados, equipe com KYC verificado e contrato renounced — padrão institucional em memecoin.",
    },
    {
      icon: "🔗",
      title: "Dogita Chain (L1)",
      desc: "Blockchain PoA EVM própria: validators Besu, blocos ~5s, explorer, faucet, DogitaSwap DEX e token factory para launch permissionless.",
    },
    {
      icon: "🏛",
      title: "Marketplace & DAO",
      desc: "Governança descentralizada, marketplace integrado e roadmap de launchpad + bridge para expansão do ecossistema.",
    },
  ],
  chainModules: [
    "EVM compatibility (Solidity / Hardhat)",
    "Besu PoA validators",
    "Explorer + faucet",
    "DogitaSwap DEX",
    "Token factory",
    "Public RPC endpoints",
  ],
};

export const domains = [
  {
    id: "backend",
    icon: "⚡",
    title: "Backend",
    desc: "APIs resilientes, arquitetura distribuída, filas, cache e observabilidade.",
    stack: ["Node.js", "Go", "PostgreSQL", "Redis", "Docker", "gRPC"],
    color: "green",
  },
  {
    id: "fullstack",
    icon: "◈",
    title: "Fullstack",
    desc: "Do schema ao pixel — produtos completos com DX e performance em mente.",
    stack: ["React", "TypeScript", "Next.js", "REST", "GraphQL", "CI/CD"],
    color: "cyan",
  },
  {
    id: "blockchain",
    icon: "⬡",
    title: "Blockchain",
    desc: "Smart contracts, DeFi, indexers e integrações on-chain/off-chain.",
    stack: ["Solidity", "EVM", "Hardhat", "ethers.js", "IPFS", "The Graph"],
    color: "purple",
  },
];

export const projects = [
  {
    title: "Buybot",
    type: "Blockchain · Backend",
    desc: "Bot de trading multi-wallet para PancakeSwap V2 na BSC e outras redes EVM.",
    tags: ["Python", "BSC", "PancakeSwap"],
    links: {
      demo: "",
      repo: "https://github.com/luanlbmk93/buybot",
    },
  },
  {
    title: "Gerador de NFT (SVG)",
    type: "Blockchain · Fullstack",
    desc: "Gera coleções de NFTs em SVG combinando corpo, fundo aleatório e camadas de acessório.",
    tags: ["JavaScript", "SVG", "NFT"],
    links: {
      demo: "",
      repo: "https://github.com/luanlbmk93/Gerador-de-NFT-Saida-SVG",
    },
  },
  {
    title: "Coin Dropper — Colete e Ganhe",
    type: "Blockchain · Game",
    desc: "Colete moedas e ganhe tokens como recompensa. Projeto web3 com foco em gameplay.",
    tags: ["JavaScript", "Web3", "Tokens"],
    links: {
      demo: "",
      repo: "https://github.com/luanlbmk93/Coin-Dropper---Colete-e-Ganhe",
    },
  },
];

export const stats = [
  { value: "3+", label: "áreas — back · full · web3" },
  { value: "∞", label: "café por sprint" },
  { value: "100%", label: "código em produção" },
];

export const principles = [
  "Código legível > código esperto",
  "Testes onde dói, não onde impressiona",
  "Métricas antes de micro-otimização",
  "Segurança desde o primeiro commit",
];
