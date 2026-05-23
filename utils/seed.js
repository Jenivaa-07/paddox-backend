
/* ============================================================
   FILE: utils/seed.js  —  Database Seeder
   ============================================================ */
const mongoose = require('mongoose');
const dotenv   = require('dotenv');
const path     = require('path');
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const User         = require('../models/User');
const Product      = require('../models/Product');
const Trivia       = require('../models/Trivia');
const Poll         = require('../models/Poll');
const DigitalAsset = require('../models/DigitalAsset');

const seedData = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('🌱 Starting seed…');

  /* Clear existing data */
  await Promise.all([User.deleteMany(), Product.deleteMany(), Trivia.deleteMany(), Poll.deleteMany(), DigitalAsset.deleteMany()]);

  /* Admin user */
  const admin = await User.create({
    firstName:'Paddox', lastName:'Admin',
    email:'admin@paddox.com', password:'paddox123', role:'admin',
  });
  console.log('✅ Admin user created: admin@paddox.com / paddox123');

  /* Sample products */
await Product.insertMany([
  {
    name:'SF-25 Podium Cap',
    slug:'sf-25-podium-cap',
    description:'Official replica Ferrari team cap worn on the Monaco podium.',
    shortDesc:'Premium Ferrari team cap.',
    team:'Ferrari',
    category:'apparel',
    price:2499,
    badge:'new',
    emoji:'🧢',
    stock:50,
    isFeatured:true,
    sizes:['S','M','L','XL'],
    images:[
      {
        url:'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=600&q=80',
        alt:'SF-25 Cap'
      }
    ],
    createdBy:admin._id
  },

  {
    name:'RB20 Team Tee',
    slug:'rb20-team-tee',
    description:'Premium cotton tee featuring the Red Bull Racing livery.',
    shortDesc:'Red Bull Racing tee.',
    team:'Red Bull',
    category:'apparel',
    price:3999,
    badge:'hot',
    emoji:'👕',
    stock:35,
    isFeatured:true,
    sizes:['XS','S','M','L','XL','XXL'],
    images:[
      {
        url:'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&q=80',
        alt:'RB20 Tee'
      }
    ],
    createdBy:admin._id
  },

  {
    name:'Monaco Circuit Watch',
    slug:'monaco-circuit-watch',
    description:'Limited edition timepiece with Monaco circuit engraving. Only 200 units.',
    shortDesc:'Limited Monaco watch.',
    team:'Paddox',
    category:'accessories',
    price:18999,
    badge:'ltd',
    emoji:'⌚',
    stock:4,
    isLimited:true,
    isFeatured:true,
    images:[
      {
        url:'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&q=80',
        alt:'Monaco Watch'
      }
    ],
    createdBy:admin._id
  },

  {
    name:'F1 Helmet Replica',
    slug:'f1-helmet-replica',
    description:'Full-size replica helmet in gloss red and chrome finish. Display stand included.',
    shortDesc:'Full-size F1 helmet replica.',
    team:'Collector',
    category:'collectibles',
    price:14999,
    badge:'ltd',
    emoji:'🪖',
    stock:0,
    isLimited:true,
    images:[
      {
        url:'https://images.unsplash.com/photo-1547036967-23d11aacaee0?w=600&q=80',
        alt:'F1 Helmet'
      }
    ],
    createdBy:admin._id
  },
]);
  console.log('✅ Products seeded');

  /* Sample trivia */
  await Trivia.insertMany([
    { question:'Which driver holds the most F1 World Championships?', options:['Ayrton Senna','Michael Schumacher','Lewis Hamilton','Sebastian Vettel'], correctIndex:2, difficulty:'easy', points:100, category:'drivers' },
    { question:'What does DRS stand for?', options:['Data Recording System','Drag Reduction System','Dynamic Race Strategy','Driver Radio Signal'], correctIndex:1, difficulty:'easy', points:100, category:'rules' },
    { question:'Which circuit is known as "The Cathedral of Speed"?', options:['Monaco','Silverstone','Monza','Suzuka'], correctIndex:2, difficulty:'medium', points:150, category:'circuits' },
    { question:'In which year was Formula 1 first held?', options:['1948','1950','1952','1955'], correctIndex:1, difficulty:'medium', points:150, category:'history' },
  ]);
  console.log('✅ Trivia seeded');

  /* Sample poll */
  await Poll.create({
    question: "Who will win the 2025 Drivers' Championship?",
    options: [{ label:'Max Verstappen 🔵', votes:420 },{ label:'Charles Leclerc 🔴', votes:240 },{ label:'Lando Norris 🟠', votes:190 },{ label:'Lewis Hamilton ⭐', votes:150 }],
    isActive: true,
    createdBy: admin._id,
  });
  console.log('✅ Poll seeded');

  /* Sample digital assets */
  await DigitalAsset.insertMany([
    { name:'Ferrari SF-26', description:'Stunning 4K wallpaper of the Ferrari SF-26.', category:'cars', type:'free', resolution:'4K', fileSize:'8.2 MB', downloads:1240, image:{ url:'https://res.cloudinary.com/drgjslwau/image/upload/v1779467063/F1_Discord_Banner_le2axa.jpg' }, uploadedBy:admin._id },
    { name:'Rebull F1 Poster', description:'Breathtaking of F1 Redbull poster.', category:'art', type:'free', resolution:'2K', fileSize:'6.8 MB', downloads:2100, image:{ url:'https://res.cloudinary.com/drgjslwau/image/upload/v1779466889/Red_bull_f1_k48xqy.jpg' }, uploadedBy:admin._id },
    { name:'Mercedes At Silverstone Win', description:'Mercedes Silverstone Win — perfect desktop wallpaper.', category:'circuits', type:'free', resolution:'2K', fileSize:'7.6 MB', downloads:2780, image:{ url:'https://res.cloudinary.com/drgjslwau/image/upload/v1779466682/pexels-jonathanborba-29252129_xekqjf.jpg' }, uploadedBy:admin._id },
  ]);
  console.log('✅ Digital assets seeded');

  console.log('\n🏁 Seed complete!');
  console.log('   Admin: admin@paddox.com / paddox123');
  process.exit(0);
};

seedData().catch(err => { console.error('❌ Seed failed:', err); process.exit(1); });