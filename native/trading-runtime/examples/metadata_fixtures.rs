//! Test-only dynamic action decoder; the production metadata API is typed.
use polymarket_runtime::{market_json::JsString, metadata::*};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{self, Read},
};
fn units(value: &Value) -> JsString {
    JsString::from_units(
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_u64().unwrap() as u16)
            .collect(),
    )
}
fn tree(value: &Value, graph: &MetadataGraph) -> MetadataValue {
    match value {
        Value::Null => MetadataValue::Null,
        Value::Bool(x) => MetadataValue::Bool(*x),
        Value::Number(x) => MetadataValue::Number(x.as_f64().unwrap()),
        Value::String(x) => MetadataValue::String(x.as_str().into()),
        Value::Array(xs) => {
            let array = graph.array().unwrap();
            for x in xs {
                array.push(tree(x, graph)).unwrap()
            }
            array.into()
        }
        Value::Object(xs) => {
            let object = graph.object().unwrap();
            for (k, v) in xs {
                object.set(k.as_str(), tree(v, graph)).unwrap()
            }
            object.into()
        }
    }
}
fn value(
    value: &Value,
    graph: &MetadataGraph,
    roots: &HashMap<String, MetadataHandle>,
) -> MetadataValue {
    match value["kind"].as_str().unwrap() {
        "missing" => MetadataValue::Missing,
        "null" => MetadataValue::Null,
        "bool" => MetadataValue::Bool(value["value"].as_bool().unwrap()),
        "number" => MetadataValue::Number(f64::from_bits(
            u64::from_str_radix(value["bits"].as_str().unwrap(), 16).unwrap(),
        )),
        "string" => MetadataValue::String(units(&value["units"])),
        "ref" => roots[value["id"].as_str().unwrap()].clone().into(),
        "tree" => tree(&value["value"], graph),
        _ => panic!("value kind"),
    }
}
fn encode(value: &MetadataValue, same: Option<&MetadataHandle>) -> Value {
    match value {
        MetadataValue::Missing => json!({"kind":"missing"}),
        MetadataValue::Null => json!({"kind":"null"}),
        MetadataValue::Bool(x) => json!({"kind":"bool","value":x}),
        MetadataValue::Number(x) => {
            if x.is_nan() {
                json!({"kind":"nan"})
            } else {
                json!({"kind":"number","bits":format!("{:016x}",x.to_bits())})
            }
        }
        MetadataValue::String(x) => json!({"kind":"string","units":x.units()}),
        MetadataValue::Reference(x) => {
            json!({"kind":"reference","array":x.is_array(),"same":same.map(|other|x==other)})
        }
    }
}
fn run(row: &Value) -> Value {
    let graph = MetadataGraph::new();
    let mut roots = HashMap::<String, MetadataHandle>::new();
    let mut output = vec![];
    for step in row["actions"].as_array().unwrap() {
        let id = step["id"].as_str().unwrap_or("");
        match step["op"].as_str().unwrap(){
  "new"=>{roots.insert(id.into(),if step["array"]==true{graph.array().unwrap()}else{graph.object().unwrap()});},
  "set"=>{roots[id].set(units(&step["key"]),value(&step["value"],&graph,&roots)).unwrap();},
  "push"=>{roots[id].push(value(&step["value"],&graph,&roots)).unwrap();},
  "index"=>{roots[id].set_index(step["index"].as_u64().unwrap() as u32,value(&step["value"],&graph,&roots)).unwrap();},
  "length"=>{roots[id].set_length(step["length"].as_u64().unwrap() as u32).unwrap();},
  "delete"=>{roots[id].delete(units(&step["key"])).unwrap();},
  "deleteIndex"=>{roots[id].delete_index(step["index"].as_u64().unwrap() as u32).unwrap();},
  "alias"=>{roots.insert(id.into(),roots[step["from"].as_str().unwrap()].clone());},
  "getAlias"=>{let v=if let Some(index)=step["index"].as_u64(){roots[step["from"].as_str().unwrap()].get_index(index as u32).unwrap()}else{roots[step["from"].as_str().unwrap()].get(units(&step["key"])).unwrap()};let MetadataValue::Reference(handle)=v else{panic!("alias reference")};roots.insert(id.into(),handle);},
  "drop"=>{roots.remove(id);},
  "collect"=>{graph.collect_full().unwrap();},
  "snapshot"=>{let v=value(&step["value"],&graph,&roots);match graph.stringify(&v){Ok(text)=>output.push(json!({"kind":"snapshot","json":text})),Err(MetadataError::CircularReference)=>output.push(json!({"kind":"error","error":"TypeError","message":"Converting circular structure to JSON"})),Err(x)=>panic!("serialize {x}")}},
  "keys"=>output.push(json!({"kind":"keys","units":roots[id].keys().unwrap().iter().map(JsString::units).collect::<Vec<_>>()})),
  "probe"=>{let v=if let Some(index)=step["index"].as_u64(){roots[id].get_index(index as u32).unwrap()}else{roots[id].get(units(&step["key"])).unwrap()};output.push(json!({"kind":"probe","value":encode(&v,step["same"].as_str().map(|id|&roots[id])),"truthy":v.is_truthy()}));},
  _=>panic!("action")
 }
    }
    json!({"name":row["name"],"output":output})
}
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let rows: Value = serde_json::from_str(&input).unwrap();
    let outputs: Vec<_> = rows.as_array().unwrap().iter().map(run).collect();
    println!("{}", serde_json::to_string(&outputs).unwrap())
}
