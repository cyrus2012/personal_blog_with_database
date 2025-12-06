import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import session from "express-session";
import bcrypt from "bcrypt";
import pg from "pg";




const app = express();
const PORT = 4000;

app.use(bodyParser.urlencoded({ extended: true }));
//app.use(express.static("public"));


// Configure sessions
app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));


// The User account information is stored here for simplicity of demonstration. It should be stored in a database.
const users = new Array();


let articleSequenceNumber = 1;

const ARTICLE_DIRECTORY = "./articles";
const SEQUENCE_FILE = "sequenceNumber.json";
const saltRounds = 10;  //add salt to bcrypt

let articlesArray = new Array();
let isArticlesSorted = false;


const blogDatabase = new pg.Client({
    user: 'postgres',
    password: '123456',
    host: 'localhost',
    port: 5432,
    database: 'blog',
});

await blogDatabase.connect();

fetchArticle();

function readSequenceFile(){
  const fileName = `./${SEQUENCE_FILE}`;
  fs.readFile(fileName, 'utf8', (err, data)=>{
    if(!err)
      articleSequenceNumber = JSON.parse(data);
    else
      console.log("fail to read sequence file", err);
  });
}

function writeSequenceFile(){
  const fileName = `./${SEQUENCE_FILE}`;
  fs.writeFile(fileName, JSON.stringify(articleSequenceNumber, null, 4), 'utf8', (err)=>{
    if(err)
      console.error("fail to write sequenceNumber file", err);
  });
}

function incrementSequenceNumber(){
  articleSequenceNumber += 1;
  writeSequenceFile();
}


function writeArticleIntoFile(article) {

  // store article in JSON format
  const fileName = `${ARTICLE_DIRECTORY}/${articleSequenceNumber}.json`;
  fs.writeFile(fileName, JSON.stringify(article, null, 4), 'utf8', (err)=>{
    if(err)
      console.error("fail to write article file", err);
  });

  incrementSequenceNumber();
}

async function insertArticle(article){
  try{
    const result = await blogDatabase.query("INSERT INTO articles (title, content, date, owner_id) VALUES ($1, $2, $3, $4) RETURNING id", 
      [article.title, article.content, article.date, article.owner_id]
    );

  }catch(err){
    console.error("blog database has insert problem", err);
  }
}

//overwrite the content of the original file.
function updateArticleFile(article){
    const fileName = `${ARTICLE_DIRECTORY}/${article.id}.json`;
    fs.writeFile(fileName, JSON.stringify(article, null, 4), 'utf8', (err)=>{
      if(err)
        console.error("fail to write article file", err);
    });
}


async function updateArticle(article){
  try{
    const result = blogDatabase.query(
      "UPDATE articles SET title=$1, content=$2, date=$3 WHERE id=$4",
      [article.title, article.content, article.date, article.id]
    )
  }catch(err){
    console.error("fail to update blog database", err);
  }
}


function readArticleFiles(){
  fs.readdir(ARTICLE_DIRECTORY, {encoding:'utf8'}, (err, files)=>{
      if(err){
        console.error("fail to read articile directory", err);
      }else{
         files.forEach((file)=>{
          //console.log(`${ARTICLE_DIRECTORY}/${file}`);
          fs.readFile(`${ARTICLE_DIRECTORY}/${file}`, 'utf8', (err, data)=>{
            //to convert the string of date into Date object during parsing process
            articlesArray.push(JSON.parse(data, parseDate));  
            //console.log(data);
          });
        });
      }
  });

}

async function fetchArticle(owner_id){

  let result;

  try{
    if(owner_id){
      result = await blogDatabase.query("SELECT * FROM articles WHERE owner_id=$1", [owner_id]);
    }else{
      result = await blogDatabase.query("SELECT * FROM articles");
    }

    articlesArray = result.rows;

  }catch(err){
    console.log("fail to access blog database", err);
  }
}

function deleteArticleFile(articleId){

  fs.rm(`${ARTICLE_DIRECTORY}/${articleId}.json`, (err)=>{
    if(err){
      console.log("fail to delete file with id " + articleId);
    }
      
  });
}

async function deleteArticle(acticleId){
  try{
    const result = blogDatabase.query("DELETE FROM articles WHERE id=$1", [acticleId]);
  }catch(err){
    console.error("Problem occurs when delete a row in table articles", err);
  }
}

/**
 * It is reviver function for parse JSON to return a Date object.
 * @param {*} key the key of JSON object
 * @param {*} value the value produced by parsing the JSON key
 * @returns if the key is "date", it turn Date object. Otherwise, it return original value
 */
function parseDate(key, value) {
  if (key === "date") {
    return new Date(value);
  }
  return value;
}
    

/**
 * return Date object
 * @param {*} inputDate a string in date format "yyyy-mm-dd", which received from HTML input tag with type="date"
 */
function createDateFromDateInput(inputDate){
    const [year, month, day] = inputDate.split("-");
    const date = new Date(year, month - 1, day, 0, 0, 0);
    return date;
}

function convertToStringFormatForDateInputTag(date){
    let dateString = date.toLocaleDateString("en-US", {year: "numeric", month: "2-digit", day: "2-digit",}); //String is mm/dd/yyyy
      //console.log("before replacement, date is " + dateString);
    const [month, day, year] = dateString.split('/');
    dateString = year + "-" + month + "-" + day;
    return dateString;
}

//readSequenceFile();
//readArticleFiles();


// Route to render the edit page
// This page can only been accessed after login
app.get('/edit/:articleID', (req, res) =>{

  if(!req.session.user){
    return res.redirect("/login");
  }

  const id = req.params.articleID;
  //check if articleID is digit number
  if(id.match(/\d+/)){ 
      const articleElement = articlesArray.find((article)=> article.id == id);
      if(articleElement){
        const dateString = convertToStringFormatForDateInputTag(articleElement.date);
        return res.render("edit_article.ejs", {article:articleElement, date:dateString});
      }else{
        console.error(`Article with id S{id} does not exit.`);
        res.send('404');    
      }
  }else{
    console.log("URL:./article/XXX where XXX should be a positive number");
    res.send('404');
  }
  
});


// Route to create new article, update or delete an existing article. Then redirect to /admin page
app.post("/modified", async (req, res)=>{
  
  if(!req.session.user){
      return res.redirect("/login");
  }

  const user_id = req.session.user.id;
  //console.log("post /admin with action " + req.body.action);
  

  //delete an article
  if(req.body.action === "Delete"){
    await deleteArticle(req.body.deleteArticleId);
    /*
    const index = articlesArray.findIndex((article) => article.id == req.body.deleteArticleId);
    deleteArticleFile(req.body.deleteArticleId);
    articlesArray.splice(index, 1);
    console.log(`deleted article ${req.body.deleteArticleId}!`);
    */
  //publish a new article
  }else if(req.body.action === "Publish"){
    console.log("publish new article");
    const dateObj = createDateFromDateInput(req.body.date);
    const newArticle = {owner_id: user_id,title:req.body.title, date:dateObj, content:req.body.content};
    await insertArticle(newArticle);
    //writeArticleIntoFile(newArticle);
    //articlesArray.splice(0, 0, newArticle);
    //isArticlesSorted = false;

  //update the article
  }else if(req.body.action === "Update"){

    const dateObj = createDateFromDateInput(req.body.date);
    const newArticle = {
      owner_id: user_id,
      title:req.body.title, 
      date:dateObj, 
      content:req.body.content,
      id:req.body.articleId
    };

    await updateArticle(newArticle);
  }
    
  res.redirect("/admin");

});


// Route to render the new article page
// This page can only been accessed after login
app.get("/new", (req, res) =>{

    //go to login page when user is guest
  if(!req.session.user){
    return res.redirect("/login");
  }

  const date = new Date();
  const dateString = convertToStringFormatForDateInputTag(date);
  res.render("edit_article.ejs", {date:dateString});
});

// Route to render admin page
// This page can only been accessed after login
app.get("/admin", async (req,res)=>{

  //go to login page when user is guest
  if(!req.session.user){
    return res.redirect("/login");
  }
  
  await fetchArticle(req.session.user.id);
  res.render("admin.ejs", {articles:articlesArray});
});


app.get("/logout", (req, res)=>{

    articlesArray = [];

    req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: 'Logout failed' });
    }
      res.redirect("/home");
    });
});



app.post("/login", async (req, res)=>{
  const username = req.body.username;
  const password = req.body.password;
      
    //const loginUser = users.find((user) => user.username === username);
  try{
    const result = await blogDatabase.query("SELECT * FROM users WHERE username=$1", [username]);

    if(result.rows.length > 0){
      const loginUser = result.rows[0];

      bcrypt.compare(password, loginUser.password, (err, valid) => {
        if (err) {
          console.error("Error comparing passwords:", err);
          return res.render("login.ejs", {message:"Error: fail to comparing passwords"});    

        } else {
          if (valid) {
            req.session.user = {
              id: loginUser.id,
              username: loginUser.username
            };

            return res.redirect("/admin");
          
          } else {
            console.log("incorrect password.");
            return res.render("login.ejs", {message:"incorrect username or password."});    
          }
        }
      });

    }else{
      console.log("User not found");
      return res.render("login.ejs", {message:"incorrect username or password."});
    }

  }catch(err){
    console.error("fail to access blogDatabase", err);
    return res.render("login.ejs", {message:"database has access problem."});
  }
});



async function isUsernameExisted(username){
  //const user = users.find((user) => user.username === username);

  const users = await blogDatabase.query("SELECT * FROM users WHERE username=$1", [username]);

    if(users.rows.length > 0){
      return true;
  } 

  return false;
}


async function addUser(name, password){
  try{
    if(await isUsernameExisted(name)){
      console.log("Username has been regitsered")
      return ;
    }

    bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);

        } else {
          try{
            //users.push({id:1, username:name, password:hash});
            const date = new Date().toISOString();
            const result = await blogDatabase.query("INSERT INTO users(username, password, create_date) VALUES ($1, $2, $3) RETURNING *;", 
              [name, hash, date]);

            const user = result.rows[0];          
            console.log("has regitsered. Now log in account");
            console.log(`${user.username} password: ${user.password}`);
          }catch(err){
            console.error("cannot insert user account.", err);
          }
        }
    });

  }catch(err){
      console.error(err);
  }
}


//addUser("user1", "aabbccdd");

app.post("/register", async (req, res)=>{
  const username = req.body.username;
  const password = req.body.password;

  try{
    if(await isUsernameExisted(username)){
        console.log("Username has been regitsered(after exam user name)")
        res.render("register.ejs", {message:`username ${username} has been used. Pleaes user another!`});
        return;
    }

      bcrypt.hash(password, saltRounds,  (err, hash) => {
          if (err) {
            console.error("Error hashing password:", err);
          } else {
              const date = new Date().toISOString();
              const result = blogDatabase.query("INSERT INTO users(username, password, create_date) VALUES ($1, $2, $3) RETURNING *",
                [username, hash, date]
              );

              //users.push({id:1, username:username, password:hash});

              console.log("has regitsered. Now log in account");
              //console.log(users);
              res.redirect("/login");
          }
      });
  }catch(err){
    console.error(error);
  }
});

app.get("/register", (req, res)=>{
  res.render("register.ejs");
});

//Route to render login page
app.get("/login", (req, res)=>{
  res.render("login.ejs");
});


// Route to render the aritcle detail page
app.get('/article/:articleID', (req, res) =>{
  const id = req.params.articleID;
   //check if articleID is digit number
  if(id.match(/\d+/)){ 
     
    const articleElement = articlesArray.find((article)=> article.id == id);
    
    if(articleElement){
      return res.render("article.ejs", {article:articleElement});
    }else{
      console.log("article with id ${id} does not exit.");
      res.send('404');
    }
  }else{
    console.log("URL:./article/XXX where XXX should be a positive number");
    res.send('404');
  }
  
});

// Route to render the Guset home page
app.get("/home", async (req, res) =>{
  
  await fetchArticle();
  res.render("guest_home.ejs", {articles:articlesArray});
});

app.get("/", (req, res) =>{
  res.redirect("/home");
});


app.listen(PORT, () => {
  console.log(`Listening to port ${PORT}`);
});

